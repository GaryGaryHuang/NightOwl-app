import {
  EXPECTED_BEHAVIOR_CONFIDENCES,
  type ChangeMapReadinessV2,
  type ExpectedBehaviorConfidence,
  type ReadinessBehaviorChangeEntry,
  type ReadinessUnresolvedUnknownEntry
} from "./change-map.ts";

export type Step0ValidationCode =
  | "PARSE"
  | "SCHEMA";

export class Step0OutputValidationError extends Error {
  readonly code: Step0ValidationCode;
  readonly diagnostic: Step0ValidationDiagnostic;

  constructor(
    code: Step0ValidationCode,
    message: string,
    diagnostic: Partial<Omit<Step0ValidationDiagnostic, "code" | "message">> = {}
  ) {
    super(`Step 0 ChangeMapReadiness validation failed [${code}]: ${message}`);
    this.name = "Step0OutputValidationError";
    this.code = code;
    this.diagnostic = {
      code,
      message,
      ...diagnostic
    };
  }
}

export interface Step0ValidationDiagnostic {
  readonly code: Step0ValidationCode;
  readonly message: string;
  readonly offendingPath?: string;
  readonly allowedValues?: readonly string[];
  readonly actualSummary?: string;
  readonly repairHint?: string;
  readonly parseStage?: string;
  readonly repairKind?: Step0JsonRepairKind;
  readonly responseByteLength?: number;
  readonly errorPosition?: number;
  readonly errorLine?: number;
  readonly errorColumn?: number;
  readonly responseExcerpt?: string;
}

export interface Step0OutputValidatorInput {
  readonly responseText: string;
  readonly userContext: readonly string[];
}

export type Step0JsonRepairKind =
  | "none"
  | "trimmed"
  | "code_fence"
  | "object_extraction";

export interface Step0JsonParseMetadata {
  readonly repairKind: Step0JsonRepairKind;
  readonly responseByteLength: number;
  readonly parsedByteLength: number;
}

export interface Step0OutputValidationResult {
  readonly changeMap: ChangeMapReadinessV2;
  readonly parseMetadata: Step0JsonParseMetadata;
}

const ALLOWED_EXPECTED_BEHAVIOR_CONFIDENCES: ReadonlySet<string> = new Set(
  EXPECTED_BEHAVIOR_CONFIDENCES
);

const OVERVIEW_MARKDOWN_PREFIX = "## Changeset Overview";

/**
 * Deterministic structural validator for Step 0's `ChangeMapReadinessV2` output.
 *
 * Pure function (no I/O, no LLM). Throws `Step0OutputValidationError` with a
 * taxonomy code on any failure so the runner's existing retry path can react
 * uniformly to blank, parse, and schema failures.
 */
export class Step0OutputValidator {
  validate(input: Step0OutputValidatorInput): ChangeMapReadinessV2 {
    return this.validateDetailed(input).changeMap;
  }

  validateDetailed(input: Step0OutputValidatorInput): Step0OutputValidationResult {
    const { value: parsed, metadata: parseMetadata } = parseJson(input.responseText);
    const obj = ensurePlainObject(parsed, "top-level payload");

    const changeMap = validateChangeMapReadinessV2(obj, input);

    return { changeMap, parseMetadata };
  }
}

function validateChangeMapReadinessV2(
  obj: Record<string, unknown>,
  input: Step0OutputValidatorInput
): ChangeMapReadinessV2 {
  return deepFreeze({
    reviewObjective: validateReviewObjective(obj.reviewObjective),
    userContext: Object.freeze([...input.userContext]),
    userBehavior: validateUserBehavior(obj.userBehavior),
    missingInformation: validateMissingInformation(obj.missingInformation),
    overviewMarkdown: validateOverviewMarkdown(obj.overviewMarkdown),
    behaviorChanges: validateReadinessBehaviorChanges(obj.behaviorChanges),
    unresolvedUnknowns: validateReadinessUnresolvedUnknowns(
      obj.unresolvedUnknowns
    )
  });
}

function parseJson(
  responseText: string
): { readonly value: unknown; readonly metadata: Step0JsonParseMetadata } {
  const responseByteLength = Buffer.byteLength(responseText, "utf8");
  const trimmed = responseText.replace(/^\uFEFF/u, "").trim();
  const directRepairKind: Step0JsonRepairKind =
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
      throw new Step0OutputValidationError(
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
  throw new Step0OutputValidationError(
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
): Partial<Step0ValidationDiagnostic> {
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
    throw new Step0OutputValidationError(
      "SCHEMA",
      `${label} must be a JSON object (received ${describe(value)})`
    );
  }
  return value as Record<string, unknown>;
}

function validateReadinessUnresolvedUnknowns(
  value: unknown
): readonly ReadinessUnresolvedUnknownEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "unresolvedUnknowns must be an array"
    );
  }

  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `unresolvedUnknowns[${index}]`);

    const question = requireNonEmptyString(
      entry.question,
      `unresolvedUnknowns[${index}].question`
    );
    const resolutionPath = requireNonEmptyString(
      entry.resolutionPath,
      `unresolvedUnknowns[${index}].resolutionPath`
    );

    return { question, resolutionPath };
  });
}

function validateOverviewMarkdown(value: unknown): string {
  if (typeof value !== "string") {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "overviewMarkdown must be a string"
    );
  }
  if (!value.startsWith(OVERVIEW_MARKDOWN_PREFIX)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      `overviewMarkdown must begin with the literal prefix "${OVERVIEW_MARKDOWN_PREFIX}"`
    );
  }

  return value;
}

function validateReviewObjective(value: unknown): ChangeMapReadinessV2["reviewObjective"] {
  const obj = ensurePlainObject(value, "reviewObjective");
  const summary = requireNonEmptyString(obj.summary, "reviewObjective.summary");
  return {
    summary,
    requestedFocus: validateStringArray(
      obj.requestedFocus,
      "reviewObjective.requestedFocus"
    ),
    expectedBehaviorSummary: validateStringArray(
      obj.expectedBehaviorSummary,
      "reviewObjective.expectedBehaviorSummary"
    )
  };
}

function validateUserBehavior(
  value: unknown
): ChangeMapReadinessV2["userBehavior"] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "userBehavior must be an array"
    );
  }
  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `userBehavior[${index}]`);
    const statement = requireNonEmptyString(
      entry.statement,
      `userBehavior[${index}].statement`
    );
    return {
      statement,
      confidence: requireEnum(
        entry.confidence,
        ALLOWED_EXPECTED_BEHAVIOR_CONFIDENCES,
        `userBehavior[${index}].confidence`
      ) as ExpectedBehaviorConfidence
    };
  });
}

function validateMissingInformation(
  value: unknown
): ChangeMapReadinessV2["missingInformation"] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "missingInformation must be an array"
    );
  }
  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `missingInformation[${index}]`);
    const description = requireNonEmptyString(
      entry.description,
      `missingInformation[${index}].description`
    );
    const whyItMatters = requireNonEmptyString(
      entry.whyItMatters,
      `missingInformation[${index}].whyItMatters`
    );
    return {
      description,
      whyItMatters
    };
  });
}

function validateReadinessBehaviorChanges(
  value: unknown
): readonly ReadinessBehaviorChangeEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "behaviorChanges must be an array"
    );
  }

  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `behaviorChanges[${index}]`);

    const description = requireNonEmptyString(
      entry.description,
      `behaviorChanges[${index}].description`
    );

    return {
      description,
      files: validateStringArray(
        entry.files,
        `behaviorChanges[${index}].files`
      )
    };
  });
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Step0OutputValidationError(
      "SCHEMA",
      `${label} must be a string (received ${describe(value)})`
    );
  }
  if (value.trim().length === 0) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      `${label} must be a non-empty string`
    );
  }
  return value;
}

function requireEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string
): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    const allowedValues = [...allowed];
    throw new Step0OutputValidationError(
      "SCHEMA",
      `${label} must be one of ${allowedValues.join(", ")} (received ${describe(value)})`,
      {
        offendingPath: label,
        allowedValues,
        actualSummary: describe(value),
        repairHint: `Use one of the allowed values for ${label}.`
      }
    );
  }
  return value;
}

function validateStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError("SCHEMA", `${label} must be an array`);
  }
  return value.map((entry, index) =>
    requireNonEmptyString(entry, `${label}[${index}]`)
  );
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
