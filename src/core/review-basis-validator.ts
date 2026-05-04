import {
  REVIEW_BASIS_EVIDENCE_SOURCE_TYPES,
  REVIEW_BASIS_INFERENCE_CONFIDENCES,
  cloneReviewBasis,
  type ReviewBasisChangedBehavior,
  type ReviewBasisEvidenceRef,
  type ReviewBasisEvidenceSourceType,
  type ReviewBasisFact,
  type ReviewBasisHypothesis,
  type ReviewBasisInference,
  type ReviewBasisInferenceConfidence,
  type ReviewBasisMissingInformation,
  type ReviewBasisV1
} from "./review-basis.ts";

export class ReviewBasisValidationError extends Error {
  constructor(message: string) {
    super(`ReviewBasis validation failed: ${message}`);
    this.name = "ReviewBasisValidationError";
  }
}

const ALLOWED_EVIDENCE_SOURCE_TYPES: ReadonlySet<string> = new Set(
  REVIEW_BASIS_EVIDENCE_SOURCE_TYPES
);
const ALLOWED_INFERENCE_CONFIDENCES: ReadonlySet<string> = new Set(
  REVIEW_BASIS_INFERENCE_CONFIDENCES
);

const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "filePath",
  "roleInChangeset",
  "changedBehavior",
  "facts",
  "inferences",
  "dependencyMap",
  "flowMap",
  "testCoverage",
  "identifierRegistry",
  "hypothesisLedger",
  "missingInformation",
  "evidenceRefs"
]);

export class ReviewBasisValidator {
  validate(responseText: string): ReviewBasisV1 {
    const parsed = parseJson(responseText);
    const obj = requireObject(parsed, "top-level payload");
    rejectUnknownKeys(obj, ALLOWED_TOP_LEVEL_KEYS, "top-level payload");

    const schemaVersion = obj.schemaVersion;
    if (schemaVersion !== 1) {
      throw new ReviewBasisValidationError(
        `schemaVersion must be literal 1 (received ${describe(schemaVersion)})`
      );
    }

    const evidenceRefs = validateEvidenceRefs(obj.evidenceRefs);
    const knownEvidenceIds = new Set(evidenceRefs.map((entry) => entry.evidenceId));

    const basis: ReviewBasisV1 = {
      schemaVersion: 1,
      filePath: requireNonEmptyString(obj.filePath, "filePath"),
      roleInChangeset: requireNonEmptyString(
        obj.roleInChangeset,
        "roleInChangeset"
      ),
      changedBehavior: validateChangedBehavior(
        obj.changedBehavior,
        knownEvidenceIds
      ),
      facts: validateFacts(obj.facts, knownEvidenceIds),
      inferences: validateInferences(obj.inferences, knownEvidenceIds),
      dependencyMap: {
        upstreamCallers: validateStringArray(
          requireObject(obj.dependencyMap, "dependencyMap").upstreamCallers,
          "dependencyMap.upstreamCallers"
        ),
        downstreamConsumers: validateStringArray(
          requireObject(obj.dependencyMap, "dependencyMap").downstreamConsumers,
          "dependencyMap.downstreamConsumers"
        ),
        externalContracts: validateStringArray(
          requireObject(obj.dependencyMap, "dependencyMap").externalContracts,
          "dependencyMap.externalContracts"
        ),
        sharedStateOrSideEffects: validateStringArray(
          requireObject(obj.dependencyMap, "dependencyMap").sharedStateOrSideEffects,
          "dependencyMap.sharedStateOrSideEffects"
        )
      },
      flowMap: {
        entryPoints: validateStringArray(
          requireObject(obj.flowMap, "flowMap").entryPoints,
          "flowMap.entryPoints"
        ),
        stateTransitions: validateStringArray(
          requireObject(obj.flowMap, "flowMap").stateTransitions,
          "flowMap.stateTransitions"
        ),
        asyncBoundaries: validateStringArray(
          requireObject(obj.flowMap, "flowMap").asyncBoundaries,
          "flowMap.asyncBoundaries"
        ),
        errorPaths: validateStringArray(
          requireObject(obj.flowMap, "flowMap").errorPaths,
          "flowMap.errorPaths"
        )
      },
      testCoverage: {
        changedTests: validateStringArray(
          requireObject(obj.testCoverage, "testCoverage").changedTests,
          "testCoverage.changedTests"
        ),
        observedCoverageSignals: validateStringArray(
          requireObject(obj.testCoverage, "testCoverage").observedCoverageSignals,
          "testCoverage.observedCoverageSignals"
        ),
        coverageGaps: validateStringArray(
          requireObject(obj.testCoverage, "testCoverage").coverageGaps,
          "testCoverage.coverageGaps"
        )
      },
      identifierRegistry: {
        files: validateStringArray(
          requireObject(obj.identifierRegistry, "identifierRegistry").files,
          "identifierRegistry.files"
        ),
        symbols: validateStringArray(
          requireObject(obj.identifierRegistry, "identifierRegistry").symbols,
          "identifierRegistry.symbols"
        ),
        resourceKeys: validateStringArray(
          requireObject(obj.identifierRegistry, "identifierRegistry").resourceKeys,
          "identifierRegistry.resourceKeys"
        ),
        apiNames: validateStringArray(
          requireObject(obj.identifierRegistry, "identifierRegistry").apiNames,
          "identifierRegistry.apiNames"
        ),
        stateNames: validateStringArray(
          requireObject(obj.identifierRegistry, "identifierRegistry").stateNames,
          "identifierRegistry.stateNames"
        )
      },
      hypothesisLedger: validateHypotheses(obj.hypothesisLedger),
      missingInformation: validateMissingInformation(obj.missingInformation),
      evidenceRefs
    };

    return deepFreeze(cloneReviewBasis(basis));
  }
}

function parseJson(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch (cause) {
    throw new ReviewBasisValidationError(
      `response is not valid JSON (${(cause as Error).message ?? "unknown error"})`
    );
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewBasisValidationError(`${label} must be an object`);
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
      throw new ReviewBasisValidationError(
        `${label} contains unsupported field "${key}"`
      );
    }
  }
}

function validateEvidenceRefs(value: unknown): readonly ReviewBasisEvidenceRef[] {
  if (!Array.isArray(value)) {
    throw new ReviewBasisValidationError("evidenceRefs must be an array");
  }

  const seen = new Set<string>();
  return value.map((raw, index) => {
    const entry = requireObject(raw, `evidenceRefs[${index}]`);
    const evidenceId = requireNonEmptyString(
      entry.evidenceId,
      `evidenceRefs[${index}].evidenceId`
    );
    if (seen.has(evidenceId)) {
      throw new ReviewBasisValidationError(`duplicate evidenceId "${evidenceId}"`);
    }
    seen.add(evidenceId);

    return {
      evidenceId,
      sourceType: requireEnum(
        entry.sourceType,
        ALLOWED_EVIDENCE_SOURCE_TYPES,
        `evidenceRefs[${index}].sourceType`
      ) as ReviewBasisEvidenceSourceType,
      location: requireNonEmptyString(
        entry.location,
        `evidenceRefs[${index}].location`
      ),
      summary: requireNonEmptyString(entry.summary, `evidenceRefs[${index}].summary`)
    };
  });
}

function validateChangedBehavior(
  value: unknown,
  knownEvidenceIds: ReadonlySet<string>
): readonly ReviewBasisChangedBehavior[] {
  const seen = new Set<string>();
  return validateArray(value, "changedBehavior").map((raw, index) => {
    const entry = requireObject(raw, `changedBehavior[${index}]`);
    const changeId = requireUniqueId(
      entry.changeId,
      `changedBehavior[${index}].changeId`,
      seen
    );
    return {
      changeId,
      before: requireNonEmptyString(entry.before, `changedBehavior[${index}].before`),
      after: requireNonEmptyString(entry.after, `changedBehavior[${index}].after`),
      evidenceIds: validateEvidenceIds(
        entry.evidenceIds,
        knownEvidenceIds,
        `changedBehavior[${index}].evidenceIds`
      )
    };
  });
}

function validateFacts(
  value: unknown,
  knownEvidenceIds: ReadonlySet<string>
): readonly ReviewBasisFact[] {
  const seen = new Set<string>();
  return validateArray(value, "facts").map((raw, index) => {
    const entry = requireObject(raw, `facts[${index}]`);
    const factId = requireUniqueId(entry.factId, `facts[${index}].factId`, seen);
    return {
      factId,
      statement: requireNonEmptyString(entry.statement, `facts[${index}].statement`),
      evidenceIds: validateEvidenceIds(
        entry.evidenceIds,
        knownEvidenceIds,
        `facts[${index}].evidenceIds`
      )
    };
  });
}

function validateInferences(
  value: unknown,
  knownEvidenceIds: ReadonlySet<string>
): readonly ReviewBasisInference[] {
  const seen = new Set<string>();
  return validateArray(value, "inferences").map((raw, index) => {
    const entry = requireObject(raw, `inferences[${index}]`);
    const inferenceId = requireUniqueId(
      entry.inferenceId,
      `inferences[${index}].inferenceId`,
      seen
    );
    return {
      inferenceId,
      statement: requireNonEmptyString(
        entry.statement,
        `inferences[${index}].statement`
      ),
      basedOnEvidenceIds: validateEvidenceIds(
        entry.basedOnEvidenceIds,
        knownEvidenceIds,
        `inferences[${index}].basedOnEvidenceIds`
      ),
      confidence: requireEnum(
        entry.confidence,
        ALLOWED_INFERENCE_CONFIDENCES,
        `inferences[${index}].confidence`
      ) as ReviewBasisInferenceConfidence
    };
  });
}

function validateHypotheses(value: unknown): readonly ReviewBasisHypothesis[] {
  const seen = new Set<string>();
  return validateArray(value, "hypothesisLedger").map((raw, index) => {
    const entry = requireObject(raw, `hypothesisLedger[${index}]`);
    const hypothesisId = requireUniqueId(
      entry.hypothesisId,
      `hypothesisLedger[${index}].hypothesisId`,
      seen
    );
    return {
      hypothesisId,
      statement: requireNonEmptyString(
        entry.statement,
        `hypothesisLedger[${index}].statement`
      ),
      triggerCondition: requireNonEmptyString(
        entry.triggerCondition,
        `hypothesisLedger[${index}].triggerCondition`
      ),
      whyRelevantHere: requireNonEmptyString(
        entry.whyRelevantHere,
        `hypothesisLedger[${index}].whyRelevantHere`
      ),
      closureCriteria: validateStringArray(
        entry.closureCriteria,
        `hypothesisLedger[${index}].closureCriteria`,
        { allowEmpty: false }
      )
    };
  });
}

function validateMissingInformation(
  value: unknown
): readonly ReviewBasisMissingInformation[] {
  const seen = new Set<string>();
  return validateArray(value, "missingInformation").map((raw, index) => {
    const entry = requireObject(raw, `missingInformation[${index}]`);
    const gapId = requireUniqueId(
      entry.gapId,
      `missingInformation[${index}].gapId`,
      seen
    );
    return {
      gapId,
      description: requireNonEmptyString(
        entry.description,
        `missingInformation[${index}].description`
      ),
      whyItMatters: requireNonEmptyString(
        entry.whyItMatters,
        `missingInformation[${index}].whyItMatters`
      )
    };
  });
}

function validateEvidenceIds(
  value: unknown,
  knownEvidenceIds: ReadonlySet<string>,
  label: string
): readonly string[] {
  const seen = new Set<string>();
  return validateStringArray(value, label, { allowEmpty: false }).map((id) => {
    if (!knownEvidenceIds.has(id)) {
      throw new ReviewBasisValidationError(`${label} references unknown evidenceId "${id}"`);
    }
    if (seen.has(id)) {
      throw new ReviewBasisValidationError(`${label} duplicates evidenceId "${id}"`);
    }
    seen.add(id);
    return id;
  });
}

function validateStringArray(
  value: unknown,
  label: string,
  options: { allowEmpty: boolean } = { allowEmpty: true }
): readonly string[] {
  const array = validateArray(value, label);
  if (!options.allowEmpty && array.length === 0) {
    throw new ReviewBasisValidationError(`${label} must not be empty`);
  }
  return array.map((item, index) => requireNonEmptyString(item, `${label}[${index}]`));
}

function validateArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ReviewBasisValidationError(`${label} must be an array`);
  }
  return value;
}

function requireUniqueId(
  value: unknown,
  label: string,
  seen: Set<string>
): string {
  const id = requireNonEmptyString(value, label);
  if (seen.has(id)) {
    const idName = label.split(".").at(-1) ?? "id";
    throw new ReviewBasisValidationError(`duplicate ${idName} "${id}"`);
  }
  seen.add(id);
  return id;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReviewBasisValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string
): string {
  const text = requireNonEmptyString(value, label);
  if (!allowed.has(text)) {
    throw new ReviewBasisValidationError(`${label} has unsupported value "${text}"`);
  }
  return text;
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

function describe(value: unknown): string {
  return value === null ? "null" : typeof value;
}
