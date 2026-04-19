import type { ChangeMap } from "./change-map.ts";

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
  "behaviorChanges",
  "unresolvedUnknowns"
]);

const ALLOWED_CHANGED_FILE_KEYS = new Set([
  "path",
  "status",
  "category",
  "basis"
]);

const ALLOWED_BEHAVIOR_CHANGE_KEYS = new Set(["description", "files"]);

const ALLOWED_UNRESOLVED_UNKNOWN_KEYS = new Set([
  "question",
  "blocksFinding",
  "resolutionPath"
]);

const ALLOWED_STATUSES: ReadonlySet<string> = new Set(["A", "M", "D", "R"]);
const ALLOWED_CATEGORIES: ReadonlySet<string> = new Set([
  "feature",
  "bugfix",
  "refactor",
  "config",
  "test",
  "docs"
]);
const ALLOWED_BASES: ReadonlySet<string> = new Set([
  "name-status",
  "diff-inspected",
  "file-inspected"
]);

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
    const behaviorChanges = validateBehaviorChanges(obj.behaviorChanges, knownPaths);
    const unresolvedUnknowns = validateUnresolvedUnknowns(obj.unresolvedUnknowns);

    enforceCoverage(changedFiles, input.expectedChangedPaths);

    const changeMap: ChangeMap = {
      schemaVersion: 1,
      overviewMarkdown,
      changedFiles,
      behaviorChanges,
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

function validateChangedFiles(value: unknown): ChangedFileArray {
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
): {
  readonly path: string;
  readonly status: "A" | "M" | "D" | "R";
  readonly category:
    | "feature"
    | "bugfix"
    | "refactor"
    | "config"
    | "test"
    | "docs";
  readonly basis: "name-status" | "diff-inspected" | "file-inspected";
} {
  const entry = ensurePlainObject(rawEntry, `changedFiles[${index}]`);
  rejectUnknownKeys(entry, ALLOWED_CHANGED_FILE_KEYS, `changedFiles[${index}]`);

  const path = requireNonEmptyString(entry.path, `changedFiles[${index}].path`);
  const status = requireEnum(
    entry.status,
    ALLOWED_STATUSES,
    `changedFiles[${index}].status`
  ) as "A" | "M" | "D" | "R";
  const category = requireEnum(
    entry.category,
    ALLOWED_CATEGORIES,
    `changedFiles[${index}].category`
  ) as "feature" | "bugfix" | "refactor" | "config" | "test" | "docs";
  const basis = requireEnum(
    entry.basis,
    ALLOWED_BASES,
    `changedFiles[${index}].basis`
  ) as "name-status" | "diff-inspected" | "file-inspected";

  return { path, status, category, basis };
}

type ChangedFileArray = readonly {
  readonly path: string;
  readonly status: "A" | "M" | "D" | "R";
  readonly category: "feature" | "bugfix" | "refactor" | "config" | "test" | "docs";
  readonly basis: "name-status" | "diff-inspected" | "file-inspected";
}[];

function validateBehaviorChanges(
  value: unknown,
  knownPaths: ReadonlySet<string>
): readonly { readonly description: string; readonly files: readonly string[] }[] {
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

    return { description, files };
  });
}

function validateUnresolvedUnknowns(
  value: unknown
): readonly {
  readonly question: string;
  readonly blocksFinding: boolean;
  readonly resolutionPath: string;
}[] {
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
  changedFiles: ChangedFileArray,
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
