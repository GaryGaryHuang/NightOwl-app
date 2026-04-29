import {
  CHANGE_MAP_BASES,
  CHANGE_MAP_CATEGORIES,
  CHANGE_MAP_EVIDENCE_SOURCE_KINDS,
  CHANGE_MAP_RELATIONSHIPS,
  CHANGE_MAP_STATUSES,
  type BehaviorChangeEntry,
  type ChangedFileEntry,
  type ChangeMap,
  type ChangeMapBasis,
  type ChangeMapCategory,
  type ChangeMapEvidenceSourceKind,
  type ChangeMapRelationship,
  type ChangeMapStatus,
  type CrossFileBoundaryEntry,
  type EvidenceRefEntry,
  type FileGroupEntry,
  type TestCoverageObservationEntry,
  type UnresolvedUnknownEntry
} from "./change-map.ts";

export type Step0ValidationCode =
  | "PARSE"
  | "SCHEMA"
  | "COVERAGE"
  | "PLACEHOLDER"
  | "CORRECTNESS_JUDGMENT";

export class Step0OutputValidationError extends Error {
  readonly code: Step0ValidationCode;

  constructor(code: Step0ValidationCode, message: string) {
    super(`Step 0 ChangeMap validation failed [${code}]: ${message}`);
    this.name = "Step0OutputValidationError";
    this.code = code;
  }
}

export interface Step0OutputValidatorInput {
  readonly responseText: string;
  readonly expectedChangedPaths: readonly string[];
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

const ALLOWED_STATUSES: ReadonlySet<string> = new Set(CHANGE_MAP_STATUSES);
const ALLOWED_CATEGORIES: ReadonlySet<string> = new Set(CHANGE_MAP_CATEGORIES);
const ALLOWED_BASES: ReadonlySet<string> = new Set(CHANGE_MAP_BASES);
const ALLOWED_RELATIONSHIPS: ReadonlySet<string> = new Set(CHANGE_MAP_RELATIONSHIPS);
const ALLOWED_EVIDENCE_SOURCE_KINDS: ReadonlySet<string> = new Set(
  CHANGE_MAP_EVIDENCE_SOURCE_KINDS
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

const CORRECTNESS_KEYWORD_PATTERNS: readonly RegExp[] = [
  /\bbug\b/i,
  /\bdefect\b/i,
  /\bincorrect\b/i,
  /\bwrong\b/i,
  /\bbroken\b/i,
  /缺陷/,
  /錯誤/,
  /有問題/
];

/**
 * Deterministic structural validator for Step 0's `ChangeMap` v1 output.
 *
 * Pure function (no I/O, no LLM). Throws `Step0OutputValidationError` with a
 * taxonomy code on any failure so the runner's existing retry path can react
 * uniformly to blank, parse, schema, coverage, placeholder, and correctness-
 * judgment failures.
 */
export class Step0OutputValidator {
  validate(input: Step0OutputValidatorInput): ChangeMap {
    const parsed = parseJson(input.responseText);
    const obj = ensurePlainObject(parsed, "top-level payload");

    rejectUnknownKeys(obj, ALLOWED_TOP_LEVEL_KEYS, "top-level");

    const schemaVersion = obj.schemaVersion;
    if (schemaVersion !== 1) {
      throw new Step0OutputValidationError(
        "SCHEMA",
        `schemaVersion must be the literal number 1 (received ${describe(schemaVersion)})`
      );
    }

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

    enforceCoverage(changedFiles, input.expectedChangedPaths);

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
}

function parseJson(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch (cause) {
    throw new Step0OutputValidationError(
      "PARSE",
      `response is not valid JSON (${(cause as Error).message ?? "unknown error"})`
    );
  }
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
    rejectCorrectnessJudgment(observedChange, `fileGroups[${index}].observedChange`);

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
    rejectCorrectnessJudgment(
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
    rejectCorrectnessJudgment(description, `behaviorChanges[${index}].description`);

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
  options: { allowEmpty: boolean }
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
        `${label}[${index}] "${path}" is not present in changedFiles[].path`
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

function enforceCoverage(
  changedFiles: readonly ChangedFileEntry[],
  expectedChangedPaths: readonly string[]
): void {
  const seenExpectedPaths = new Set<string>();
  for (const expected of expectedChangedPaths) {
    if (seenExpectedPaths.has(expected)) {
      throw new Step0OutputValidationError(
        "COVERAGE",
        `expectedChangedPaths contains duplicate path "${expected}"`
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
        `changedFiles[] contains duplicate path "${entry.path}"`
      );
    }
    seenPaths.add(entry.path);
  }

  for (const expected of seenExpectedPaths) {
    if (!seenPaths.has(expected)) {
      throw new Step0OutputValidationError(
        "COVERAGE",
        `changedFiles[] is missing expected path "${expected}"`
      );
    }
  }
  for (const actual of seenPaths) {
    if (!seenExpectedPaths.has(actual)) {
      throw new Step0OutputValidationError(
        "COVERAGE",
        `changedFiles[] reports path "${actual}" that is not in the expected changeset`
      );
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
    throw new Step0OutputValidationError(
      "SCHEMA",
      `${label} must be one of ${[...allowed].join(", ")} (received ${describe(value)})`
    );
  }
  return value;
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

function rejectCorrectnessJudgment(value: string, label: string): void {
  for (const pattern of CORRECTNESS_KEYWORD_PATTERNS) {
    if (pattern.test(value)) {
      throw new Step0OutputValidationError(
        "CORRECTNESS_JUDGMENT",
        `${label} contains a correctness-judgment keyword matching ${pattern}; Step 0 must record observations, not judgments`
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
