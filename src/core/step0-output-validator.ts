import {
  CHANGE_MAP_BASES,
  CHANGE_MAP_CATEGORIES,
  CHANGE_MAP_EVIDENCE_SOURCE_KINDS,
  CHANGE_MAP_RELATIONSHIPS,
  CHANGE_MAP_STATUSES,
  EXPECTED_BEHAVIOR_CONFIDENCES,
  type BehaviorChangeEntry,
  type ChangedFileEntry,
  type ChangeMap,
  type ChangeMapBasis,
  type ChangeMapCategory,
  type ChangeMapEvidenceSourceKind,
  type ChangeMapRelationship,
  type ChangeMapReadiness,
  type ChangeMapReadinessV2,
  type ChangeMapStatus,
  type CrossFileBoundaryEntry,
  type EvidenceRefEntry,
  type ExpectedChangedFileDescriptor,
  type ExpectedBehaviorConfidence,
  type FileGroupEntry,
  type ReadinessBehaviorChangeEntry,
  type ReadinessUnresolvedUnknownEntry,
  type TestCoverageObservationEntry,
  type UnresolvedUnknownEntry
} from "./change-map.ts";

export type Step0ValidationCode =
  | "PARSE"
  | "SCHEMA"
  | "COVERAGE"
  | "PLACEHOLDER";

export class Step0OutputValidationError extends Error {
  readonly code: Step0ValidationCode;
  readonly diagnostic: Step0ValidationDiagnostic;

  constructor(
    code: Step0ValidationCode,
    message: string,
    diagnostic: Partial<Omit<Step0ValidationDiagnostic, "code" | "message">> = {}
  ) {
    super(`Step 0 ChangeMap validation failed [${code}]: ${message}`);
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
  readonly expectedChangedPaths: readonly string[];
  readonly expectedChangedFiles?: readonly ExpectedChangedFileDescriptor[];
  readonly expectedUserContext?: readonly string[];
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
  readonly changeMap: ChangeMapReadiness;
  readonly parseMetadata: Step0JsonParseMetadata;
}

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "overviewMarkdown",
  "changedFiles",
  "fileGroups",
  "crossFileBoundaries",
  "testCoverageObservations",
  "behaviorChanges",
  "evidenceRefs",
  "unresolvedUnknowns"
]);

const ALLOWED_TOP_LEVEL_KEYS_V2 = new Set([
  "schemaVersion",
  "reviewObjective",
  "userContextSSOT",
  "expectedBehaviorLedger",
  "missingInformation",
  "overviewMarkdown",
  "behaviorChanges",
  "unresolvedUnknowns"
]);

const ALLOWED_CHANGED_FILE_KEYS = new Set([
  "path",
  "status",
  "category",
  "group",
  "basis"
]);

const ALLOWED_FILE_GROUP_KEYS = new Set([
  "id",
  "label",
  "files",
  "observedChange"
]);

const ALLOWED_CROSS_FILE_BOUNDARY_KEYS = new Set([
  "from",
  "to",
  "relationship",
  "evidenceRefs"
]);

const ALLOWED_TEST_COVERAGE_OBSERVATION_KEYS = new Set([
  "sourceFile",
  "testFile",
  "observedExpectation",
  "evidenceRefs"
]);

const ALLOWED_BEHAVIOR_CHANGE_KEYS = new Set([
  "description",
  "files",
  "evidenceRefs"
]);

const ALLOWED_READINESS_BEHAVIOR_CHANGE_KEYS = new Set([
  "description",
  "files"
]);

const ALLOWED_EVIDENCE_REF_KEYS = new Set([
  "id",
  "sourceKind",
  "pathOrUrl",
  "anchor",
  "summary"
]);

const ALLOWED_UNRESOLVED_UNKNOWN_KEYS = new Set([
  "question",
  "blocksFinding",
  "resolutionPath"
]);

const ALLOWED_READINESS_UNRESOLVED_UNKNOWN_KEYS = new Set([
  "question",
  "resolutionPath"
]);

const ALLOWED_STATUSES: ReadonlySet<string> = new Set(CHANGE_MAP_STATUSES);
const ALLOWED_CATEGORIES: ReadonlySet<string> = new Set(CHANGE_MAP_CATEGORIES);
const ALLOWED_BASES: ReadonlySet<string> = new Set(CHANGE_MAP_BASES);
const ALLOWED_RELATIONSHIPS: ReadonlySet<string> = new Set(CHANGE_MAP_RELATIONSHIPS);
const ALLOWED_EVIDENCE_SOURCE_KINDS: ReadonlySet<string> = new Set(
  CHANGE_MAP_EVIDENCE_SOURCE_KINDS
);
const ALLOWED_EXPECTED_BEHAVIOR_CONFIDENCES: ReadonlySet<string> = new Set(
  EXPECTED_BEHAVIOR_CONFIDENCES
);

const OVERVIEW_MARKDOWN_PREFIX = "## Changeset Overview";

// Placeholder markers as discrete tokens; case-insensitive whole-token match
// for short markers, plus an angle-bracket template token form like `<replace>`.
const PLACEHOLDER_TOKEN_PATTERNS: readonly RegExp[] = [
  /\bTODO\b/i,
  /\bTBD\b/i,
  /\bN\/?A\b/i,
  /\bplaceholder\b/i,
  /\bfill\s*me\b/i,
  /<[^<>\n]+>/
];

/**
 * Deterministic structural validator for Step 0's `ChangeMap` v1 output.
 *
 * Pure function (no I/O, no LLM). Throws `Step0OutputValidationError` with a
 * taxonomy code on any failure so the runner's existing retry path can react
 * uniformly to blank, parse, schema, coverage, and placeholder failures.
 */
export class Step0OutputValidator {
  validate(input: Step0OutputValidatorInput): ChangeMapReadiness {
    return this.validateDetailed(input).changeMap;
  }

  validateDetailed(input: Step0OutputValidatorInput): Step0OutputValidationResult {
    const { value: parsed, metadata: parseMetadata } = parseJson(input.responseText);
    const obj = ensurePlainObject(parsed, "top-level payload");

    const schemaVersion = obj.schemaVersion;
    let changeMap: ChangeMapReadiness;
    if (schemaVersion === 1) {
      rejectUnknownKeys(obj, ALLOWED_TOP_LEVEL_KEYS, "top-level");
      changeMap = validateLegacyChangeMap(obj, input);
    } else if (schemaVersion === 2) {
      rejectUnknownKeys(obj, ALLOWED_TOP_LEVEL_KEYS_V2, "top-level");
      changeMap = validateChangeMapReadinessV2(obj, input);
    } else {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `schemaVersion must be the literal number 1 or 2 (received ${describe(schemaVersion)})`,
        {
          offendingPath: "schemaVersion",
          allowedValues: ["1", "2"],
          actualSummary: describe(schemaVersion),
          repairHint: "Use schemaVersion: 2 for ChangeMapReadinessV2."
        }
      );
    }

    return { changeMap, parseMetadata };
  }
}

function validateLegacyChangeMap(
  obj: Record<string, unknown>,
  input: Step0OutputValidatorInput
): ChangeMap {
  const overviewMarkdown = obj.overviewMarkdown;
  if (typeof overviewMarkdown !== "string") {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "overviewMarkdown must be a string"
    );
  }
  if (!overviewMarkdown.startsWith(OVERVIEW_MARKDOWN_PREFIX)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      `overviewMarkdown must begin with the literal prefix "${OVERVIEW_MARKDOWN_PREFIX}"`
    );
  }

  const changedFiles = validateChangedFiles(obj.changedFiles);
  const knownPaths = new Set(changedFiles.map((entry) => entry.path));
  const fileGroups = validateFileGroups(obj.fileGroups, changedFiles, knownPaths);
  const evidenceRefs = validateEvidenceRefs(obj.evidenceRefs);
  const knownEvidenceRefIds = new Set(evidenceRefs.map((entry) => entry.id));
  const crossFileBoundaries = validateCrossFileBoundaries(
    obj.crossFileBoundaries,
    knownEvidenceRefIds
  );
  const testCoverageObservations = validateTestCoverageObservations(
    obj.testCoverageObservations,
    knownPaths,
    knownEvidenceRefIds
  );
  const behaviorChanges = validateBehaviorChanges(
    obj.behaviorChanges,
    knownPaths,
    knownEvidenceRefIds
  );
  const unresolvedUnknowns = validateUnresolvedUnknowns(obj.unresolvedUnknowns);

  enforceCoverage(changedFiles, input);

  const changeMap: ChangeMap = {
    schemaVersion: 1,
    overviewMarkdown,
    changedFiles,
    fileGroups,
    crossFileBoundaries,
    testCoverageObservations,
    behaviorChanges,
    evidenceRefs,
    unresolvedUnknowns
  };

  return deepFreeze(changeMap);
}

function validateChangeMapReadinessV2(
  obj: Record<string, unknown>,
  input: Step0OutputValidatorInput
): ChangeMapReadinessV2 {
  return deepFreeze({
    schemaVersion: 2,
    reviewObjective: validateReviewObjective(obj.reviewObjective),
    userContextSSOT: validateUserContextSSOT(
      obj.userContextSSOT,
      input.expectedUserContext
    ),
    expectedBehaviorLedger: validateExpectedBehaviorLedger(
      obj.expectedBehaviorLedger
    ),
    missingInformation: validateMissingInformation(obj.missingInformation),
    overviewMarkdown: validateOverviewMarkdown(obj.overviewMarkdown),
    behaviorChanges: validateReadinessBehaviorChanges(
      obj.behaviorChanges,
      new Set(input.expectedChangedPaths)
    ),
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

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `${label} contains unsupported field "${key}"`
      );
    }
  }
}

function validateChangedFiles(value: unknown): readonly ChangedFileEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "changedFiles must be an array"
    );
  }

  return value.map((rawEntry, index) => validateChangedFile(rawEntry, index));
}

function validateChangedFile(
  rawEntry: unknown,
  index: number
): ChangedFileEntry {
  const entry = ensurePlainObject(rawEntry, `changedFiles[${index}]`);
  rejectUnknownKeys(entry, ALLOWED_CHANGED_FILE_KEYS, `changedFiles[${index}]`);

  const path = requireNonEmptyString(entry.path, `changedFiles[${index}].path`);
  const status = requireEnum(
    entry.status,
    ALLOWED_STATUSES,
    `changedFiles[${index}].status`
  ) as ChangeMapStatus;
  const category = requireEnum(
    entry.category,
    ALLOWED_CATEGORIES,
    `changedFiles[${index}].category`
  ) as ChangeMapCategory;
  const group = requireNonEmptyString(entry.group, `changedFiles[${index}].group`);
  rejectPlaceholderText(group, `changedFiles[${index}].group`);
  const basis = requireEnum(
    entry.basis,
    ALLOWED_BASES,
    `changedFiles[${index}].basis`
  ) as ChangeMapBasis;

  return { path, status, category, group, basis };
}

function validateFileGroups(
  value: unknown,
  changedFiles: readonly ChangedFileEntry[],
  knownPaths: ReadonlySet<string>
): readonly FileGroupEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError("SCHEMA", "fileGroups must be an array");
  }

  const groupLabels = new Set<string>();
  const groupIds = new Set<string>();
  const result = value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `fileGroups[${index}]`);
    rejectUnknownKeys(entry, ALLOWED_FILE_GROUP_KEYS, `fileGroups[${index}]`);

    const id = requireNonEmptyString(entry.id, `fileGroups[${index}].id`);
    const label = requireNonEmptyString(entry.label, `fileGroups[${index}].label`);
    const observedChange = requireNonEmptyString(
      entry.observedChange,
      `fileGroups[${index}].observedChange`
    );

    rejectPlaceholderText(label, `fileGroups[${index}].label`);
    rejectPlaceholderText(observedChange, `fileGroups[${index}].observedChange`);

    if (groupIds.has(id)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `fileGroups[${index}].id duplicates an earlier id "${id}"`
      );
    }
    if (groupLabels.has(label)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `fileGroups[${index}].label duplicates an earlier label "${label}"`
      );
    }
    groupIds.add(id);
    groupLabels.add(label);

    const files = validateKnownPathsArray(
      entry.files,
      knownPaths,
      `fileGroups[${index}].files`,
      { allowEmpty: false }
    );

    return { id, label, files, observedChange };
  });

  for (const changedFile of changedFiles) {
    if (!groupLabels.has(changedFile.group)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `changedFiles group "${changedFile.group}" does not match any fileGroups[].label`
      );
    }
  }

  return result;
}

function validateEvidenceRefs(value: unknown): readonly EvidenceRefEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError("SCHEMA", "evidenceRefs must be an array");
  }

  const seenIds = new Set<string>();
  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `evidenceRefs[${index}]`);
    rejectUnknownKeys(entry, ALLOWED_EVIDENCE_REF_KEYS, `evidenceRefs[${index}]`);

    const id = requireNonEmptyString(entry.id, `evidenceRefs[${index}].id`);
    const sourceKind = requireEnum(
      entry.sourceKind,
      ALLOWED_EVIDENCE_SOURCE_KINDS,
      `evidenceRefs[${index}].sourceKind`
    ) as ChangeMapEvidenceSourceKind;
    const pathOrUrl = requireNonEmptyString(
      entry.pathOrUrl,
      `evidenceRefs[${index}].pathOrUrl`
    );
    const anchor = requireNonEmptyString(entry.anchor, `evidenceRefs[${index}].anchor`);
    const summary = requireNonEmptyString(entry.summary, `evidenceRefs[${index}].summary`);

    rejectPlaceholderText(pathOrUrl, `evidenceRefs[${index}].pathOrUrl`);
    rejectPlaceholderText(anchor, `evidenceRefs[${index}].anchor`);
    rejectPlaceholderText(summary, `evidenceRefs[${index}].summary`);

    if (seenIds.has(id)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `evidenceRefs[${index}].id duplicates an earlier id "${id}"`
      );
    }
    seenIds.add(id);

    return { id, sourceKind, pathOrUrl, anchor, summary };
  });
}

function validateCrossFileBoundaries(
  value: unknown,
  knownEvidenceRefIds: ReadonlySet<string>
): readonly CrossFileBoundaryEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "crossFileBoundaries must be an array"
    );
  }

  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `crossFileBoundaries[${index}]`);
    rejectUnknownKeys(
      entry,
      ALLOWED_CROSS_FILE_BOUNDARY_KEYS,
      `crossFileBoundaries[${index}]`
    );

    const from = requireNonEmptyString(entry.from, `crossFileBoundaries[${index}].from`);
    const to = requireNonEmptyString(entry.to, `crossFileBoundaries[${index}].to`);
    const relationship = requireEnum(
      entry.relationship,
      ALLOWED_RELATIONSHIPS,
      `crossFileBoundaries[${index}].relationship`
    ) as ChangeMapRelationship;
    const evidenceRefs = validateEvidenceRefIds(
      entry.evidenceRefs,
      knownEvidenceRefIds,
      `crossFileBoundaries[${index}].evidenceRefs`
    );

    return { from, to, relationship, evidenceRefs };
  });
}

function validateTestCoverageObservations(
  value: unknown,
  knownPaths: ReadonlySet<string>,
  knownEvidenceRefIds: ReadonlySet<string>
): readonly TestCoverageObservationEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "testCoverageObservations must be an array"
    );
  }

  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `testCoverageObservations[${index}]`);
    rejectUnknownKeys(
      entry,
      ALLOWED_TEST_COVERAGE_OBSERVATION_KEYS,
      `testCoverageObservations[${index}]`
    );

    const sourceFile = requireNonEmptyString(
      entry.sourceFile,
      `testCoverageObservations[${index}].sourceFile`
    );
    const testFile = requireNonEmptyString(
      entry.testFile,
      `testCoverageObservations[${index}].testFile`
    );
    const observedExpectation = requireNonEmptyString(
      entry.observedExpectation,
      `testCoverageObservations[${index}].observedExpectation`
    );

    if (!knownPaths.has(sourceFile)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `testCoverageObservations[${index}].sourceFile "${sourceFile}" is not present in changedFiles[].path`
      );
    }
    if (!knownPaths.has(testFile)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `testCoverageObservations[${index}].testFile "${testFile}" is not present in changedFiles[].path`
      );
    }

    rejectPlaceholderText(
      observedExpectation,
      `testCoverageObservations[${index}].observedExpectation`
    );

    const evidenceRefs = validateEvidenceRefIds(
      entry.evidenceRefs,
      knownEvidenceRefIds,
      `testCoverageObservations[${index}].evidenceRefs`
    );

    return { sourceFile, testFile, observedExpectation, evidenceRefs };
  });
}

function validateBehaviorChanges(
  value: unknown,
  knownPaths: ReadonlySet<string>,
  knownEvidenceRefIds: ReadonlySet<string>
): readonly BehaviorChangeEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "behaviorChanges must be an array"
    );
  }

  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `behaviorChanges[${index}]`);
    rejectUnknownKeys(
      entry,
      ALLOWED_BEHAVIOR_CHANGE_KEYS,
      `behaviorChanges[${index}]`
    );

    const description = requireNonEmptyString(
      entry.description,
      `behaviorChanges[${index}].description`
    );

    rejectPlaceholderText(description, `behaviorChanges[${index}].description`);

    const filesValue = entry.files;
    if (!Array.isArray(filesValue)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `behaviorChanges[${index}].files must be an array`
      );
    }

    const files = filesValue.map((file, fileIndex) => {
      const filePath = requireNonEmptyString(
        file,
        `behaviorChanges[${index}].files[${fileIndex}]`
      );
      if (!knownPaths.has(filePath)) {
        throw new Step0OutputValidationError(
          "SCHEMA",
          `behaviorChanges[${index}].files[${fileIndex}] "${filePath}" is not present in changedFiles[].path`
        );
      }
      return filePath;
    });

    const evidenceRefs = validateEvidenceRefIds(
      entry.evidenceRefs,
      knownEvidenceRefIds,
      `behaviorChanges[${index}].evidenceRefs`
    );

    return { description, files, evidenceRefs };
  });
}

function validateEvidenceRefIds(
  value: unknown,
  knownEvidenceRefIds: ReadonlySet<string>,
  label: string
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      `${label} must be a non-empty array`
    );
  }

  const seen = new Set<string>();
  return value.map((rawId, index) => {
    const id = requireNonEmptyString(rawId, `${label}[${index}]`);
    if (!knownEvidenceRefIds.has(id)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `${label}[${index}] "${id}" is not present in evidenceRefs[].id`
      );
    }
    if (seen.has(id)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `${label}[${index}] duplicates evidence ref id "${id}"`
      );
    }
    seen.add(id);
    return id;
  });
}

function validateKnownPathsArray(
  value: unknown,
  knownPaths: ReadonlySet<string>,
  label: string,
  options: { allowEmpty: boolean; knownPathsLabel?: string }
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError("SCHEMA", `${label} must be an array`);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new Step0OutputValidationError("SCHEMA", `${label} must not be empty`);
  }

  const seen = new Set<string>();
  return value.map((rawPath, index) => {
    const path = requireNonEmptyString(rawPath, `${label}[${index}]`);
    if (!knownPaths.has(path)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `${label}[${index}] "${path}" is not present in ${options.knownPathsLabel ?? "changedFiles[].path"}`
      );
    }
    if (seen.has(path)) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `${label}[${index}] duplicates path "${path}"`
      );
    }
    seen.add(path);
    return path;
  });
}

function validateUnresolvedUnknowns(
  value: unknown
): readonly UnresolvedUnknownEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "unresolvedUnknowns must be an array"
    );
  }

  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `unresolvedUnknowns[${index}]`);
    rejectUnknownKeys(
      entry,
      ALLOWED_UNRESOLVED_UNKNOWN_KEYS,
      `unresolvedUnknowns[${index}]`
    );

    const question = requireNonEmptyString(
      entry.question,
      `unresolvedUnknowns[${index}].question`
    );
    rejectPlaceholderText(question, `unresolvedUnknowns[${index}].question`);

    if (typeof entry.blocksFinding !== "boolean") {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `unresolvedUnknowns[${index}].blocksFinding must be a boolean`
      );
    }

    const resolutionPath = requireNonEmptyString(
      entry.resolutionPath,
      `unresolvedUnknowns[${index}].resolutionPath`
    );
    rejectPlaceholderText(
      resolutionPath,
      `unresolvedUnknowns[${index}].resolutionPath`
    );

    return {
      question,
      blocksFinding: entry.blocksFinding,
      resolutionPath
    };
  });
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
    rejectUnknownKeys(
      entry,
      ALLOWED_READINESS_UNRESOLVED_UNKNOWN_KEYS,
      `unresolvedUnknowns[${index}]`
    );

    const question = requireNonEmptyString(
      entry.question,
      `unresolvedUnknowns[${index}].question`
    );
    const resolutionPath = requireNonEmptyString(
      entry.resolutionPath,
      `unresolvedUnknowns[${index}].resolutionPath`
    );
    rejectPlaceholderText(question, `unresolvedUnknowns[${index}].question`);
    rejectPlaceholderText(
      resolutionPath,
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
  rejectPlaceholderText(summary, "reviewObjective.summary");
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

function validateUserContextSSOT(
  value: unknown,
  expectedUserContext: readonly string[] | undefined
): ChangeMapReadinessV2["userContextSSOT"] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError("SCHEMA", "userContextSSOT must be an array");
  }
  if (expectedUserContext && value.length !== expectedUserContext.length) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      `userContextSSOT length must match expected user context length ${expectedUserContext.length}`
    );
  }

  return value.map((rawEntry, index) => {
    const rawText = requireNonEmptyString(
      rawEntry,
      `userContextSSOT[${index}]`
    );
    if (expectedUserContext && rawText !== expectedUserContext[index]) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `userContextSSOT[${index}] must preserve user context order`
      );
    }

    return rawText;
  });
}

function validateExpectedBehaviorLedger(
  value: unknown
): ChangeMapReadinessV2["expectedBehaviorLedger"] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "expectedBehaviorLedger must be an array"
    );
  }
  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `expectedBehaviorLedger[${index}]`);
    const statement = requireNonEmptyString(
      entry.statement,
      `expectedBehaviorLedger[${index}].statement`
    );
    rejectPlaceholderText(statement, `expectedBehaviorLedger[${index}].statement`);
    return {
      statement,
      confidence: requireEnum(
        entry.confidence,
        ALLOWED_EXPECTED_BEHAVIOR_CONFIDENCES,
        `expectedBehaviorLedger[${index}].confidence`
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
    rejectPlaceholderText(description, `missingInformation[${index}].description`);
    rejectPlaceholderText(whyItMatters, `missingInformation[${index}].whyItMatters`);
    return {
      description,
      whyItMatters
    };
  });
}

function validateReadinessBehaviorChanges(
  value: unknown,
  knownPaths: ReadonlySet<string>
): readonly ReadinessBehaviorChangeEntry[] {
  if (!Array.isArray(value)) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      "behaviorChanges must be an array"
    );
  }

  return value.map((rawEntry, index) => {
    const entry = ensurePlainObject(rawEntry, `behaviorChanges[${index}]`);
    rejectUnknownKeys(
      entry,
      ALLOWED_READINESS_BEHAVIOR_CHANGE_KEYS,
      `behaviorChanges[${index}]`
    );

    const description = requireNonEmptyString(
      entry.description,
      `behaviorChanges[${index}].description`
    );
    rejectPlaceholderText(description, `behaviorChanges[${index}].description`);

    return {
      description,
      files: validateKnownPathsArray(
        entry.files,
        knownPaths,
        `behaviorChanges[${index}].files`,
        {
          allowEmpty: false,
          knownPathsLabel: "<changed_files_json>.entries[].path"
        }
      )
    };
  });
}

function enforceCoverage(
  changedFiles: readonly ChangedFileEntry[],
  input: Step0OutputValidatorInput
): void {
  const expectedChangedPaths = input.expectedChangedPaths;
  const seenExpectedPaths = new Set<string>();
  for (const expected of expectedChangedPaths) {
    if (seenExpectedPaths.has(expected)) {
      throw new Step0OutputValidationError(
        "COVERAGE",
        `expectedChangedPaths contains duplicate path "${expected}"`,
        {
          offendingPath: "expectedChangedPaths",
          actualSummary: `duplicate=${expected}`,
          repairHint: "Host-normalized changed file paths must be unique before Step 0 validation."
        }
      );
    }
    seenExpectedPaths.add(expected);
  }

  // Duplicate-path detection — duplicates are surfaced as COVERAGE failures
  // because Step 0 should report each changed path exactly once.
  const seenPaths = new Set<string>();
  for (const entry of changedFiles) {
    if (seenPaths.has(entry.path)) {
      throw new Step0OutputValidationError(
        "COVERAGE",
        `changedFiles[] contains duplicate path "${entry.path}"`,
        {
          offendingPath: "changedFiles",
          actualSummary: `duplicate=${entry.path}`,
          repairHint: "List each host-normalized changed file exactly once."
        }
      );
    }
    seenPaths.add(entry.path);
  }

  for (const expected of seenExpectedPaths) {
    if (!seenPaths.has(expected)) {
      throw new Step0OutputValidationError(
        "COVERAGE",
        `changedFiles[] is missing expected path "${expected}"`,
        {
          offendingPath: "changedFiles",
          actualSummary: `missing=${expected}`,
          repairHint: "Add the missing head-side path from changed_files_json."
        }
      );
    }
  }
  for (const actual of seenPaths) {
    if (!seenExpectedPaths.has(actual)) {
      throw new Step0OutputValidationError(
        "COVERAGE",
        `changedFiles[] reports path "${actual}" that is not in the expected changeset`,
        {
          offendingPath: "changedFiles",
          actualSummary: `extra=${actual}`,
          repairHint: "Remove paths that are absent from changed_files_json."
        }
      );
    }
  }

  if (input.expectedChangedFiles) {
    const expectedByPath = new Map(
      input.expectedChangedFiles.map((entry) => [entry.path, entry.status] as const)
    );
    for (const entry of changedFiles) {
      const expectedStatus = expectedByPath.get(entry.path);
      if (expectedStatus && entry.status !== expectedStatus) {
        throw new Step0OutputValidationError(
          "COVERAGE",
          `changedFiles[] status for "${entry.path}" must be "${expectedStatus}" (received "${entry.status}")`,
          {
            offendingPath: "changedFiles",
            actualSummary: `path=${entry.path}, expectedStatus=${expectedStatus}, actualStatus=${entry.status}`,
            repairHint: "Use the normalized status from changed_files_json; copied files use A."
          }
        );
      }
    }
  }
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
  return value.map((entry, index) => {
    const text = requireNonEmptyString(entry, `${label}[${index}]`);
    rejectPlaceholderText(text, `${label}[${index}]`);
    return text;
  });
}

function validateEnumArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      `${label} must be a non-empty array`
    );
  }
  return value.map((entry, index) => requireEnum(entry, allowed, `${label}[${index}]`));
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Step0OutputValidationError(
      "SCHEMA",
      `${label} must be a non-negative integer`
    );
  }
  return value as number;
}

function rejectPlaceholderText(value: string, label: string): void {
  for (const pattern of PLACEHOLDER_TOKEN_PATTERNS) {
    if (pattern.test(value)) {
      throw new Step0OutputValidationError(
        "PLACEHOLDER",
        `${label} appears to contain a placeholder marker matching ${pattern}`
      );
    }
  }
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
