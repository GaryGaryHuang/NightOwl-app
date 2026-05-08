import {
  REVIEW_BASIS_INFERENCE_CONFIDENCES,
  cloneReviewBasis,
  type ReviewBasisChangedBehavior,
  type ReviewBasisDependencyMap,
  type ReviewBasisEvidenceRef,
  type ReviewBasisFact,
  type ReviewBasisFlowMap,
  type ReviewBasisHypothesis,
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
    const rawRoleInChangeset = optionalString(obj.roleInChangeset);
    const evidenceRefs = validateEvidenceRefs(obj.evidenceRefs, diagnostics);
    const evidenceIdSet = new Set(evidenceRefs.map((entry) => entry.evidenceId));
    const changedBehavior = validateChangedBehavior(
      obj.changedBehavior,
      evidenceIdSet,
      diagnostics
    );
    const facts = validateFacts(obj.facts, evidenceIdSet, diagnostics);
    const inferences = validateInferences(
      obj.inferences,
      evidenceIdSet,
      diagnostics
    );
    const dependencyMap = validateDependencyMap(obj.dependencyMap);
    const flowMap = validateFlowMap(obj.flowMap);
    const testCoverage = validateTestCoverage(obj.testCoverage);
    const hypothesisLedger = validateHypotheses(obj.hypothesisLedger, diagnostics);
    const missingInformation = validateMissingInformation(
      obj.missingInformation,
      diagnostics
    );
    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }
    if (
      !rawRoleInChangeset &&
      !hasReviewBasisContent({
        changedBehavior,
        dependencyMap,
        evidenceRefs,
        facts,
        flowMap,
        hypothesisLedger,
        inferences,
        missingInformation,
        testCoverage
      })
    ) {
      return fail(
        "SCHEMA",
        "review basis must contain roleInChangeset or at least one structured basis signal"
      );
    }
    const roleInChangeset =
      rawRoleInChangeset ?? `Changed file under review: ${filePath}`;

    const basis: ReviewBasisV1 = {
      filePath,
      roleInChangeset,
      changedBehavior,
      facts,
      inferences,
      dependencyMap,
      flowMap,
      testCoverage,
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
    return [];
  }

  const byEvidenceId = new Map<string, ReviewBasisEvidenceRef>();
  return value.flatMap((raw, index) => {
    const entry = asPlainRecord(raw);
    if (!entry) {
      diagnostics.push({ code: "SCHEMA", message: `evidenceRefs[${index}] must be an object` });
      return [];
    }
    const evidenceId = optionalString(entry.evidenceId);
    if (!evidenceId) {
      diagnostics.push({ code: "SCHEMA", message: `evidenceRefs[${index}].evidenceId must be a non-empty string` });
      return [];
    }
    if (byEvidenceId.has(evidenceId)) {
      diagnostics.push({
        code: "SCHEMA",
        message: `evidenceRefs[].evidenceId must be unique; duplicate value "${evidenceId}"`
      });
      return [];
    }
    const sourceType = optionalString(entry.sourceType) ?? "unknown";
    const location = optionalString(entry.location) ?? "";
    const summary = optionalString(entry.summary) ?? "";
    const normalized = { evidenceId, sourceType, location, summary };
    byEvidenceId.set(evidenceId, normalized);
    return [normalized];
  });
}

function validateChangedBehavior(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisChangedBehavior[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((raw, index) => {
    const entry = asPlainRecord(raw);
    if (!entry) {
      diagnostics.push({ code: "SCHEMA", message: `changedBehavior[${index}] must be an object` });
      return [];
    }
    const before = optionalString(entry.before);
    const after = optionalString(entry.after);
    if (!before || !after) {
      diagnostics.push({ code: "SCHEMA", message: `changedBehavior[${index}] requires non-empty before and after` });
      return [];
    }
    return [{
      before,
      after,
      evidenceIds: validateEvidenceIdArray(
        entry.evidenceIds,
        evidenceIds,
        `changedBehavior[${index}].evidenceIds`,
        diagnostics
      )
    }];
  });
}

function validateFacts(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisFact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((raw, index) => {
    const entry = asPlainRecord(raw);
    if (!entry) {
      diagnostics.push({ code: "SCHEMA", message: `facts[${index}] must be an object` });
      return [];
    }
    const statement = optionalString(entry.statement);
    if (!statement) {
      diagnostics.push({ code: "SCHEMA", message: `facts[${index}].statement must be a non-empty string` });
      return [];
    }
    return [{
      statement,
      evidenceIds: validateEvidenceIdArray(
        entry.evidenceIds,
        evidenceIds,
        `facts[${index}].evidenceIds`,
        diagnostics
      )
    }];
  });
}

function validateInferences(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisInference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((raw, index) => {
    const entry = asPlainRecord(raw);
    if (!entry) {
      diagnostics.push({ code: "SCHEMA", message: `inferences[${index}] must be an object` });
      return [];
    }
    const statement = optionalString(entry.statement);
    if (!statement) {
      diagnostics.push({ code: "SCHEMA", message: `inferences[${index}].statement must be a non-empty string` });
      return [];
    }
    const confidence = optionalString(entry.confidence);
    return [{
      statement,
      basedOnEvidenceIds: validateEvidenceIdArray(
        entry.basedOnEvidenceIds,
        evidenceIds,
        `inferences[${index}].basedOnEvidenceIds`,
        diagnostics
      ),
      confidence: ALLOWED_INFERENCE_CONFIDENCES.has(confidence ?? "")
        ? confidence as ReviewBasisInferenceConfidence
        : "low"
    }];
  });
}

function validateDependencyMap(value: unknown): ReviewBasisDependencyMap {
  const empty: ReviewBasisDependencyMap = { upstreamCallers: [], downstreamConsumers: [], externalContracts: [], sharedStateOrSideEffects: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

function validateFlowMap(value: unknown): ReviewBasisFlowMap {
  const empty: ReviewBasisFlowMap = { entryPoints: [], stateTransitions: [], asyncBoundaries: [], errorPaths: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

function validateTestCoverage(value: unknown): ReviewBasisTestCoverage {
  const empty: ReviewBasisTestCoverage = { changedTests: [], observedCoverageSignals: [], coverageGaps: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return empty;
  }
  const obj = value as Record<string, unknown>;
  return {
    changedTests: toStringArray(obj.changedTests),
    observedCoverageSignals: toStringArray(obj.observedCoverageSignals),
    coverageGaps: toStringArray(obj.coverageGaps)
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
  const normalized: ReviewBasisHypothesis[] = [];
  for (const [index, raw] of value.entries()) {
    const entry = asPlainRecord(raw);
    if (!entry) {
      diagnostics.push({ code: "SCHEMA", message: `hypothesisLedger[${index}] must be an object` });
      continue;
    }
    const statement = optionalString(entry.statement);
    const triggerCondition = optionalString(entry.triggerCondition);
    if (!statement || !triggerCondition) {
      diagnostics.push({ code: "SCHEMA", message: `hypothesisLedger[${index}] requires statement and triggerCondition` });
      continue;
    }
    normalized.push({
      hypothesisId: `H${normalized.length + 1}`,
      statement,
      triggerCondition
    });
  }
  return normalized;
}

function validateMissingInformation(
  value: unknown,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly ReviewBasisMissingInformation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((raw, index) => {
    const entry = asPlainRecord(raw);
    if (!entry) {
      diagnostics.push({ code: "SCHEMA", message: `missingInformation[${index}] must be an object` });
      return [];
    }
    const description = optionalString(entry.description);
    const whyItMatters = optionalString(entry.whyItMatters);
    if (!description || !whyItMatters) {
      diagnostics.push({ code: "SCHEMA", message: `missingInformation[${index}] requires description and whyItMatters` });
      return [];
    }
    return [{ description, whyItMatters }];
  });
}

function hasReviewBasisContent(input: {
  changedBehavior: readonly ReviewBasisChangedBehavior[];
  dependencyMap: ReviewBasisDependencyMap;
  evidenceRefs: readonly ReviewBasisEvidenceRef[];
  facts: readonly ReviewBasisFact[];
  flowMap: ReviewBasisFlowMap;
  hypothesisLedger: readonly ReviewBasisHypothesis[];
  inferences: readonly ReviewBasisInference[];
  missingInformation: readonly ReviewBasisMissingInformation[];
  testCoverage: ReviewBasisTestCoverage;
}): boolean {
  return [
    input.changedBehavior,
    input.evidenceRefs,
    input.facts,
    input.hypothesisLedger,
    input.inferences,
    input.missingInformation,
    input.dependencyMap.upstreamCallers,
    input.dependencyMap.downstreamConsumers,
    input.dependencyMap.externalContracts,
    input.dependencyMap.sharedStateOrSideEffects,
    input.flowMap.entryPoints,
    input.flowMap.stateTransitions,
    input.flowMap.asyncBoundaries,
    input.flowMap.errorPaths,
    input.testCoverage.changedTests,
    input.testCoverage.observedCoverageSignals,
    input.testCoverage.coverageGaps
  ].some((entries) => entries.length > 0);
}

function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function validateEvidenceIdArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  fieldName: string,
  diagnostics: ReviewBasisValidationDiagnostic[]
): readonly string[] {
  const ids = toStringArray(value);
  for (const id of ids) {
    if (!allowed.has(id)) {
      diagnostics.push({
        code: "SCHEMA",
        message: `${fieldName} references unknown evidenceId "${id}"`
      });
    }
  }
  return ids;
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
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
