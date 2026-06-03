import {
  EXPECTED_BEHAVIOR_CONFIDENCES,
  type ChangeMapReadiness,
  type ExpectedBehaviorConfidence,
  type ReadinessBehaviorChangeEntry
} from "./change-map.ts";

export type ChangesetOverviewValidationCode =
  | "PARSE"
  | "SCHEMA";

export class ChangesetOverviewOutputValidationError extends Error {
  readonly code: ChangesetOverviewValidationCode;
  readonly diagnostic: ChangesetOverviewValidationDiagnostic;

  constructor(
    code: ChangesetOverviewValidationCode,
    message: string,
    diagnostic: Partial<Omit<ChangesetOverviewValidationDiagnostic, "code" | "message">> = {}
  ) {
    super(`Changeset Overview ChangeMapReadiness validation failed [${code}]: ${message}`);
    this.name = "ChangesetOverviewOutputValidationError";
    this.code = code;
    this.diagnostic = {
      code,
      message,
      ...diagnostic
    };
  }
}

export interface ChangesetOverviewValidationDiagnostic {
  readonly code: ChangesetOverviewValidationCode;
  readonly message: string;
  readonly actualSummary?: string;
  readonly repairHint?: string;
  readonly parseStage?: string;
  readonly responseByteLength?: number;
  readonly errorPosition?: number;
  readonly errorLine?: number;
  readonly errorColumn?: number;
  readonly responseExcerpt?: string;
}

export interface ChangesetOverviewOutputValidatorInput {
  readonly responseText: string;
  readonly userContext: readonly string[];
}

export type ChangesetOverviewJsonRepairKind =
  | "none"
  | "trimmed"
  | "code_fence"
  | "object_extraction";

export interface ChangesetOverviewJsonParseMetadata {
  readonly repairKind: ChangesetOverviewJsonRepairKind;
  readonly responseByteLength: number;
  readonly parsedByteLength: number;
}

export interface ChangesetOverviewOutputValidationResult {
  readonly changeMap: ChangeMapReadiness;
  readonly parseMetadata: ChangesetOverviewJsonParseMetadata;
}

const ALLOWED_EXPECTED_BEHAVIOR_CONFIDENCES: ReadonlySet<string> = new Set(
  EXPECTED_BEHAVIOR_CONFIDENCES
);

const OVERVIEW_MARKDOWN_PREFIX = "## Changeset Overview";

/**
 * Deterministic structural validator for Changeset Overview's `ChangeMapReadiness` output.
 *
 * Pure function (no I/O, no LLM). Throws `ChangesetOverviewOutputValidationError` with a
 * taxonomy code on any failure so the runner's existing retry path can react
 * uniformly to blank, parse, and schema failures.
 */
export class ChangesetOverviewOutputValidator {
  validateDetailed(input: ChangesetOverviewOutputValidatorInput): ChangesetOverviewOutputValidationResult {
    const { value: parsed, metadata: parseMetadata } = parseJson(input.responseText);
    const obj = ensurePlainObject(parsed, "top-level payload");

    const changeMap = validateChangeMapReadiness(obj, input);

    return { changeMap, parseMetadata };
  }
}

function validateChangeMapReadiness(
  obj: Record<string, unknown>,
  input: ChangesetOverviewOutputValidatorInput
): ChangeMapReadiness {
  const userBehavior = validateUserBehavior(obj.userBehavior);
  const missingInformation = validateMissingInformation(obj.missingInformation);
  const behaviorChanges = validateReadinessBehaviorChanges(obj.behaviorChanges);
  const reviewObjective = validateReviewObjective(obj.reviewObjective, {
    behaviorChanges,
    missingInformation,
    overviewMarkdown: obj.overviewMarkdown,
    userBehavior
  });
  const overviewMarkdown = validateOverviewMarkdown({
    value: obj.overviewMarkdown,
    behaviorChanges,
    reviewObjective
  });

  return deepFreeze({
    reviewObjective,
    userContext: Object.freeze([...input.userContext]),
    userBehavior,
    missingInformation,
    overviewMarkdown,
    behaviorChanges
  });
}

function parseJson(
  responseText: string
): { readonly value: unknown; readonly metadata: ChangesetOverviewJsonParseMetadata } {
  const responseByteLength = Buffer.byteLength(responseText, "utf8");
  const trimmed = responseText.replace(/^\uFEFF/u, "").trim();
  const directRepairKind: ChangesetOverviewJsonRepairKind =
    trimmed === responseText ? "none" : "trimmed";

  try {
    return {
      value: JSON.parse(trimmed),
      metadata: {
        repairKind: directRepairKind,
        responseByteLength,
        parsedByteLength: Buffer.byteLength(trimmed, "utf8")
      }
    };
  } catch (cause) {
    const fenced = extractWrappingJsonFence(trimmed);
    if (fenced !== undefined) {
      try {
        return {
          value: JSON.parse(fenced),
          metadata: {
            repairKind: "code_fence",
            responseByteLength,
            parsedByteLength: Buffer.byteLength(fenced, "utf8")
          }
        };
      } catch {
        throwParseFailure(responseText, cause, "code_fence_inner_parse");
      }
    }

    const extracted = extractSingleRootObject(trimmed);
    if (extracted.status === "multiple") {
      throw new ChangesetOverviewOutputValidationError(
        "PARSE",
        "response contains multiple root JSON objects",
        {
          parseStage: "root_object_detection",
          actualSummary: summarizeResponse(responseText),
          repairHint: "Return exactly one JSON object and no second object or trailing payload.",
          responseByteLength
        }
      );
    }
    if (extracted.status === "single") {
      try {
        return {
          value: JSON.parse(extracted.text),
          metadata: {
            repairKind:
              extracted.text === trimmed ? directRepairKind : "object_extraction",
            responseByteLength,
            parsedByteLength: Buffer.byteLength(extracted.text, "utf8")
          }
        };
      } catch {
        throwParseFailure(responseText, cause, "root_object_parse");
      }
    }

    throwParseFailure(responseText, cause, "initial_parse");
  }
}

function throwParseFailure(
  responseText: string,
  cause: unknown,
  parseStage: string
): never {
  const causeMessage = cause instanceof Error && cause.message
    ? cause.message
    : "unknown error";
  throw new ChangesetOverviewOutputValidationError(
    "PARSE",
    `response is not valid JSON (${causeMessage})`,
    {
      parseStage,
      actualSummary: summarizeResponse(responseText),
      repairHint: "Return exactly one JSON object with no Markdown fence or explanatory text.",
      responseByteLength: Buffer.byteLength(responseText, "utf8"),
      ...buildParseFailureContext(responseText, causeMessage)
    }
  );
}

function buildParseFailureContext(
  responseText: string,
  causeMessage: string
): Partial<ChangesetOverviewValidationDiagnostic> {
  const errorPosition = extractJsonParseErrorPosition(causeMessage);
  if (errorPosition === undefined) {
    return {};
  }

  const location = lineColumnAt(responseText, errorPosition);
  return {
    errorPosition,
    errorLine: location.line,
    errorColumn: location.column,
    responseExcerpt: excerptAround(responseText, errorPosition)
  };
}

function extractJsonParseErrorPosition(message: string): number | undefined {
  const match = message.match(/position (\d+)/u);
  if (!match) {
    return undefined;
  }

  const position = Number(match[1]);
  return Number.isSafeInteger(position) && position >= 0 ? position : undefined;
}

function lineColumnAt(value: string, position: number): { line: number; column: number } {
  const target = Math.min(position, value.length);
  let line = 1;
  let column = 1;

  for (let index = 0; index < target; index += 1) {
    if (value[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function excerptAround(value: string, position: number): string {
  const radius = 120;
  const safePosition = Math.min(Math.max(position, 0), value.length);
  const start = Math.max(0, safePosition - radius);
  const end = Math.min(value.length, safePosition + radius);
  const prefix = start === 0 ? "" : "...";
  const suffix = end === value.length ? "" : "...";

  return `${prefix}${value.slice(start, safePosition)}<<<ERROR>>>${value.slice(safePosition, end)}${suffix}`;
}

function extractWrappingJsonFence(value: string): string | undefined {
  const match = value.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
  return match?.[1]?.trim();
}

function extractSingleRootObject(
  value: string
):
  | { readonly status: "none" }
  | { readonly status: "multiple" }
  | { readonly status: "single"; readonly text: string } {
  const spans: { start: number; end: number }[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 0) {
        return { status: "none" };
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push({ start, end: index + 1 });
        start = -1;
      }
    }
  }

  if (depth !== 0 || spans.length === 0) {
    return { status: "none" };
  }
  if (spans.length > 1) {
    return { status: "multiple" };
  }
  const [span] = spans;
  return { status: "single", text: value.slice(span.start, span.end) };
}

function summarizeResponse(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "empty_response";
  }
  return `length=${Buffer.byteLength(value, "utf8")}, prefix=${JSON.stringify(trimmed.slice(0, 40))}, suffix=${JSON.stringify(trimmed.slice(-40))}`;
}

function ensurePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChangesetOverviewOutputValidationError(
      "SCHEMA",
      `${label} must be a JSON object (received ${describe(value)})`
    );
  }
  return value as Record<string, unknown>;
}

function validateOverviewMarkdown(input: {
  value: unknown;
  reviewObjective: ChangeMapReadiness["reviewObjective"];
  behaviorChanges: readonly ReadinessBehaviorChangeEntry[];
}): string {
  const value = optionalNonEmptyString(input.value);
  if (!value) {
    return buildOverviewMarkdownFallback(input.reviewObjective, input.behaviorChanges);
  }
  if (value.startsWith(OVERVIEW_MARKDOWN_PREFIX)) {
    return value;
  }

  const lines = value.split("\n");
  if (/^#+\s*changeset overview\s*$/iu.test(lines[0] ?? "")) {
    return [OVERVIEW_MARKDOWN_PREFIX, ...lines.slice(1)].join("\n");
  }

  return `${OVERVIEW_MARKDOWN_PREFIX}\n${value}`;
}

function buildOverviewMarkdownFallback(
  reviewObjective: ChangeMapReadiness["reviewObjective"],
  behaviorChanges: readonly ReadinessBehaviorChangeEntry[]
): string {
  const behaviorSummary = behaviorChanges[0]?.description ?? "none recorded";
  const expectedBehavior =
    reviewObjective.expectedBehaviorSummary[0] ?? "none recorded";

  return [
    OVERVIEW_MARKDOWN_PREFIX,
    `- Scope: ${reviewObjective.summary}`,
    "- Cross-file boundaries: none recorded",
    `- Behavior changes: ${behaviorSummary}`,
    `- Test coverage observations: ${expectedBehavior}`
  ].join("\n");
}

function validateReviewObjective(
  value: unknown,
  fallback: {
    behaviorChanges: readonly ReadinessBehaviorChangeEntry[];
    missingInformation: ChangeMapReadiness["missingInformation"];
    overviewMarkdown: unknown;
    userBehavior: ChangeMapReadiness["userBehavior"];
  }
): ChangeMapReadiness["reviewObjective"] {
  const obj = asPlainRecord(value);

  const summary =
    optionalNonEmptyString(obj?.summary) ??
    summarizeOverviewMarkdown(fallback.overviewMarkdown) ??
    fallback.behaviorChanges[0]?.description ??
    fallback.userBehavior[0]?.statement ??
    fallback.missingInformation[0]?.description;
  if (!summary) {
    throw new ChangesetOverviewOutputValidationError(
      "SCHEMA",
      "reviewObjective.summary or overviewMarkdown must provide non-empty review context"
    );
  }
  return {
    summary,
    requestedFocus: validateStringArray(obj?.requestedFocus),
    expectedBehaviorSummary: validateStringArray(obj?.expectedBehaviorSummary)
  };
}

function summarizeOverviewMarkdown(value: unknown): string | undefined {
  const overview = optionalNonEmptyString(value);
  if (!overview) {
    return undefined;
  }

  return overview
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/u, ""))
    .find((line) => line.length > 0 && !/^#+\s*changeset overview\s*$/iu.test(line));
}

function validateUserBehavior(
  value: unknown
): ChangeMapReadiness["userBehavior"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((rawEntry) => {
    const entry = asPlainRecord(rawEntry);
    if (!entry) {
      return [];
    }

    const statement = optionalNonEmptyString(entry.statement);
    if (!statement) {
      return [];
    }
    return {
      statement,
      confidence: normalizeExpectedBehaviorConfidence(entry.confidence)
    };
  });
}

function validateMissingInformation(
  value: unknown
): ChangeMapReadiness["missingInformation"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((rawEntry) => {
    const entry = asPlainRecord(rawEntry);
    if (!entry) {
      return [];
    }

    const description = optionalNonEmptyString(entry.description);
    if (!description) {
      return [];
    }
    return {
      description,
      whyItMatters:
        optionalNonEmptyString(entry.whyItMatters) ??
        "This missing context may affect subsequent per-file review."
    };
  });
}

function validateReadinessBehaviorChanges(
  value: unknown
): readonly ReadinessBehaviorChangeEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((rawEntry) => {
    const entry = asPlainRecord(rawEntry);
    if (!entry) {
      return [];
    }

    const description = optionalNonEmptyString(entry.description);
    if (!description) {
      return [];
    }

    return {
      description,
      files: validateStringArray(entry.files)
    };
  });
}

function normalizeExpectedBehaviorConfidence(
  value: unknown
): ExpectedBehaviorConfidence {
  if (typeof value === "string" && ALLOWED_EXPECTED_BEHAVIOR_CONFIDENCES.has(value)) {
    return value as ExpectedBehaviorConfidence;
  }
  return "inferred";
}

function validateStringArray(value: unknown): readonly string[] {
  if (typeof value === "string") {
    const item = optionalNonEmptyString(value);
    return item ? [item] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = optionalNonEmptyString(entry);
    return item ? [item] : [];
  });
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}
