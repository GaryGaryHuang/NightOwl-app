import {
  REVIEW_BASIS_INFERENCE_CONFIDENCES,
  cloneReviewBasis,
  type ReviewBasisChangedBehavior,
  type ReviewBasisDependencyMap,
  type ReviewBasisEvidenceRef,
  type ReviewBasisFact,
  type ReviewBasisFlowMap,
  type ReviewBasisHypothesis,
  type ReviewBasisIdentifierRegistry,
  type ReviewBasisInference,
  type ReviewBasisInferenceConfidence,
  type ReviewBasisMissingInformation,
  type ReviewBasisTestCoverage,
  type ReviewBasisV1
} from "./review-basis.ts";

export type ReviewBasisValidationCode = "PARSE" | "SCHEMA";

export interface ReviewBasisValidationDiagnostic {
  readonly code: ReviewBasisValidationCode;
  readonly message: string;
}

export type ReviewBasisValidationResult =
  | { readonly ok: true; readonly value: ReviewBasisV1 }
  | { readonly ok: false; readonly diagnostics: readonly ReviewBasisValidationDiagnostic[] };

const ALLOWED_INFERENCE_CONFIDENCES: ReadonlySet<string> = new Set(
  REVIEW_BASIS_INFERENCE_CONFIDENCES
);

export interface ReviewBasisValidatorInput {
  readonly responseText: string;
  readonly filePath: string;
}

export class ReviewBasisValidator {
  validate(input: ReviewBasisValidatorInput): ReviewBasisValidationResult {
    const { responseText, filePath } = input;

    const parseResult = repairAndParse(responseText);
    if (!parseResult.ok) {
      return { ok: false, diagnostics: parseResult.diagnostics };
    }
    const parsed = parseResult.value;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fail("SCHEMA", "top-level payload must be an object");
    }
    const obj = parsed as Record<string, unknown>;

    const diagnostics: ReviewBasisValidationDiagnostic[] = [];

    const roleInChangeset = optionalString(obj.roleInChangeset) ?? "";
    if (!roleInChangeset) {
      diagnostics.push({ code: "SCHEMA", message: "roleInChangeset must be a non-empty string" });
    }

    const evidenceRefs = validateEvidenceRefs(obj.evidenceRefs, diagnostics);
    const changedBehavior = validateChangedBehavior(obj.changedBehavior, diagnostics);
    const facts = validateFacts(obj.facts, diagnostics);
    const inferences = validateInferences(obj.inferences, diagnostics);
    const dependencyMap = validateDependencyMap(obj.dependencyMap, diagnostics);
    const flowMap = validateFlowMap(obj.flowMap, diagnostics);
    const testCoverage = validateTestCoverage(obj.testCoverage, diagnostics);
    const identifierRegistry = validateIdentifierRegistry(obj.identifierRegistry, diagnostics);
    const hypothesisLedger = validateHypotheses(obj.hypothesisLedger, diagnostics);
    const missingInformation = validateMissingInformation(obj.missingInformation, diagnostics);

    validateReviewBasisReferences({
      evidenceRefs,
      changedBehavior,
      facts,
      inferences,
      hypothesisLedger,
      diagnostics
    });

    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }

    const basis: ReviewBasisV1 = {
      filePath,
      roleInChangeset,
      changedBehavior,
      facts,
      inferences,
      dependencyMap,
      flowMap,
      testCoverage,
      identifierRegistry,
      hypothesisLedger,
      missingInformation,
      evidenceRefs
    };

    return { ok: true, value: deepFreeze(cloneReviewBasis(basis)) };
  }
}

function fail(code: ReviewBasisValidationCode, message: string): ReviewBasisValidationResult {
  return { ok: false, diagnostics: [{ code, message }] };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function validateEvidenceRefs(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisEvidenceRef[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "evidenceRefs must be an array" });
    return [];
  }

  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      diagnostics.push({ code: "SCHEMA", message: `evidenceRefs[${index}] must be an object` });
      return [];
    }
    const entry = raw as Record<string, unknown>;
    const evidenceId = optionalString(entry.evidenceId);
    if (!evidenceId) {
      diagnostics.push({ code: "SCHEMA", message: `evidenceRefs[${index}].evidenceId must be a non-empty string` });
      return [];
    }
    const sourceType = optionalString(entry.sourceType) ?? "unknown";
    const location = optionalString(entry.location) ?? "";
    const summary = optionalString(entry.summary) ?? "";
    return [{ evidenceId, sourceType, location, summary }];
  });
}

function validateReviewBasisReferences(input: {
  evidenceRefs: readonly ReviewBasisEvidenceRef[];
  changedBehavior: readonly ReviewBasisChangedBehavior[];
  facts: readonly ReviewBasisFact[];
  inferences: readonly ReviewBasisInference[];
  hypothesisLedger: readonly ReviewBasisHypothesis[];
  diagnostics: ReviewBasisValidationDiagnostic[];
}): void {
  const evidenceIds = input.evidenceRefs.map((entry) => entry.evidenceId);
  assertUniqueValues(evidenceIds, "evidenceRefs[].evidenceId", input.diagnostics);
  assertKnownEvidenceIds(
    input.changedBehavior.flatMap((entry) => entry.evidenceIds),
    new Set(evidenceIds),
    "changedBehavior[].evidenceIds",
    input.diagnostics
  );
  assertKnownEvidenceIds(
    input.facts.flatMap((entry) => entry.evidenceIds),
    new Set(evidenceIds),
    "facts[].evidenceIds",
    input.diagnostics
  );
  assertKnownEvidenceIds(
    input.inferences.flatMap((entry) => entry.basedOnEvidenceIds),
    new Set(evidenceIds),
    "inferences[].basedOnEvidenceIds",
    input.diagnostics
  );
  assertUniqueValues(
    input.hypothesisLedger.map((entry) => entry.hypothesisId),
    "hypothesisLedger[].hypothesisId",
    input.diagnostics
  );
}

function assertUniqueValues(
  values: readonly string[],
  fieldName: string,
  diagnostics: ReviewBasisValidationDiagnostic[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      diagnostics.push({
        code: "SCHEMA",
        message: `${fieldName} must be unique; duplicate value "${value}"`
      });
    }
    seen.add(value);
  }
}

function assertKnownEvidenceIds(
  values: readonly string[],
  evidenceIds: ReadonlySet<string>,
  fieldName: string,
  diagnostics: ReviewBasisValidationDiagnostic[]
): void {
  for (const value of values) {
    if (!evidenceIds.has(value)) {
      diagnostics.push({
        code: "SCHEMA",
        message: `${fieldName} references unknown evidenceId "${value}"`
      });
    }
  }
}

function validateChangedBehavior(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisChangedBehavior[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "changedBehavior must be an array" });
    return [];
  }
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      diagnostics.push({ code: "SCHEMA", message: `changedBehavior[${index}] must be an object` });
      return [];
    }
    const entry = raw as Record<string, unknown>;
    const before = optionalString(entry.before);
    const after = optionalString(entry.after);
    if (!before || !after) {
      diagnostics.push({ code: "SCHEMA", message: `changedBehavior[${index}] requires non-empty before and after` });
      return [];
    }
    return [{ before, after, evidenceIds: toStringArray(entry.evidenceIds) }];
  });
}

function validateFacts(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisFact[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "facts must be an array" });
    return [];
  }
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      diagnostics.push({ code: "SCHEMA", message: `facts[${index}] must be an object` });
      return [];
    }
    const entry = raw as Record<string, unknown>;
    const statement = optionalString(entry.statement);
    if (!statement) {
      diagnostics.push({ code: "SCHEMA", message: `facts[${index}].statement must be a non-empty string` });
      return [];
    }
    return [{ statement, evidenceIds: toStringArray(entry.evidenceIds) }];
  });
}

function validateInferences(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisInference[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "inferences must be an array" });
    return [];
  }
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      diagnostics.push({ code: "SCHEMA", message: `inferences[${index}] must be an object` });
      return [];
    }
    const entry = raw as Record<string, unknown>;
    const statement = optionalString(entry.statement);
    if (!statement) {
      diagnostics.push({ code: "SCHEMA", message: `inferences[${index}].statement must be a non-empty string` });
      return [];
    }
    const confidence = optionalString(entry.confidence);
    if (!confidence || !ALLOWED_INFERENCE_CONFIDENCES.has(confidence)) {
      diagnostics.push({ code: "SCHEMA", message: `inferences[${index}].confidence must be one of: high, medium, low` });
      return [];
    }
    return [{
      statement,
      basedOnEvidenceIds: toStringArray(entry.basedOnEvidenceIds),
      confidence: confidence as ReviewBasisInferenceConfidence
    }];
  });
}

function validateDependencyMap(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): ReviewBasisDependencyMap {
  const empty: ReviewBasisDependencyMap = { upstreamCallers: [], downstreamConsumers: [], externalContracts: [], sharedStateOrSideEffects: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "dependencyMap must be an object" });
    return empty;
  }
  const obj = value as Record<string, unknown>;
  return {
    upstreamCallers: toStringArray(obj.upstreamCallers),
    downstreamConsumers: toStringArray(obj.downstreamConsumers),
    externalContracts: toStringArray(obj.externalContracts),
    sharedStateOrSideEffects: toStringArray(obj.sharedStateOrSideEffects)
  };
}

function validateFlowMap(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): ReviewBasisFlowMap {
  const empty: ReviewBasisFlowMap = { entryPoints: [], stateTransitions: [], asyncBoundaries: [], errorPaths: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "flowMap must be an object" });
    return empty;
  }
  const obj = value as Record<string, unknown>;
  return {
    entryPoints: toStringArray(obj.entryPoints),
    stateTransitions: toStringArray(obj.stateTransitions),
    asyncBoundaries: toStringArray(obj.asyncBoundaries),
    errorPaths: toStringArray(obj.errorPaths)
  };
}

function validateTestCoverage(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): ReviewBasisTestCoverage {
  const empty: ReviewBasisTestCoverage = { changedTests: [], observedCoverageSignals: [], coverageGaps: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "testCoverage must be an object" });
    return empty;
  }
  const obj = value as Record<string, unknown>;
  return {
    changedTests: toStringArray(obj.changedTests),
    observedCoverageSignals: toStringArray(obj.observedCoverageSignals),
    coverageGaps: toStringArray(obj.coverageGaps)
  };
}

function validateIdentifierRegistry(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): ReviewBasisIdentifierRegistry {
  const empty: ReviewBasisIdentifierRegistry = { files: [], symbols: [], resourceKeys: [], apiNames: [], stateNames: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "identifierRegistry must be an object" });
    return empty;
  }
  const obj = value as Record<string, unknown>;
  return {
    files: toStringArray(obj.files),
    symbols: toStringArray(obj.symbols),
    resourceKeys: toStringArray(obj.resourceKeys),
    apiNames: toStringArray(obj.apiNames),
    stateNames: toStringArray(obj.stateNames)
  };
}

function validateHypotheses(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisHypothesis[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "hypothesisLedger must be an array" });
    return [];
  }
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      diagnostics.push({ code: "SCHEMA", message: `hypothesisLedger[${index}] must be an object` });
      return [];
    }
    const entry = raw as Record<string, unknown>;
    const hypothesisId = optionalString(entry.hypothesisId);
    const statement = optionalString(entry.statement);
    const triggerCondition = optionalString(entry.triggerCondition);
    if (!hypothesisId || !statement || !triggerCondition) {
      diagnostics.push({ code: "SCHEMA", message: `hypothesisLedger[${index}] requires hypothesisId, statement, triggerCondition` });
      return [];
    }
    return [{ hypothesisId, statement, triggerCondition }];
  });
}

function validateMissingInformation(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisMissingInformation[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ code: "SCHEMA", message: "missingInformation must be an array" });
    return [];
  }
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      diagnostics.push({ code: "SCHEMA", message: `missingInformation[${index}] must be an object` });
      return [];
    }
    const entry = raw as Record<string, unknown>;
    const description = optionalString(entry.description);
    const whyItMatters = optionalString(entry.whyItMatters);
    if (!description || !whyItMatters) {
      diagnostics.push({ code: "SCHEMA", message: `missingInformation[${index}] requires description and whyItMatters` });
      return [];
    }
    return [{ description, whyItMatters }];
  });
}

function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function repairAndParse(
  responseText: string
): { ok: true; value: unknown } | { ok: false; diagnostics: readonly ReviewBasisValidationDiagnostic[] } {
  const trimmed = responseText.replace(/^\uFEFF/u, "").trim();

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // continue to repair attempts
  }

  const fenced = extractWrappingJsonFence(trimmed);
  if (fenced !== undefined) {
    try {
      return { ok: true, value: JSON.parse(fenced) };
    } catch {
      // fall through
    }
  }

  const extracted = extractSingleRootObject(trimmed);
  if (extracted.status === "single") {
    try {
      return { ok: true, value: JSON.parse(extracted.text) };
    } catch {
      // fall through
    }
  }

  return fail("PARSE", "response is not valid JSON");
}

function extractWrappingJsonFence(value: string): string | undefined {
  const match = value.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
  return match?.[1]?.trim();
}

function extractSingleRootObject(
  value: string
):
  | { readonly status: "none" }
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
    return { status: "none" };
  }
  const [span] = spans;
  return { status: "single", text: value.slice(span.start, span.end) };
}
