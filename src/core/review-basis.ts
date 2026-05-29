export const REVIEW_BASIS_INFERENCE_CONFIDENCES = [
  "high",
  "low"
] as const;

export type ReviewBasisInferenceConfidence =
  (typeof REVIEW_BASIS_INFERENCE_CONFIDENCES)[number];

export interface ReviewBasisChangedBehavior {
  readonly before: string;
  readonly after: string;
  readonly evidenceIds: readonly string[];
}

export interface ReviewBasisFact {
  readonly statement: string;
  readonly evidenceIds: readonly string[];
}

export interface ReviewBasisInference {
  readonly statement: string;
  readonly basedOnEvidenceIds: readonly string[];
  readonly confidence: ReviewBasisInferenceConfidence;
}

export interface ReviewBasisDependencyMap {
  readonly upstreamCallers: readonly string[];
  readonly downstreamConsumers: readonly string[];
  readonly externalContracts: readonly string[];
  readonly sharedStateOrSideEffects: readonly string[];
}

export interface ReviewBasisFlowMap {
  readonly entryPoints: readonly string[];
  readonly stateTransitions: readonly string[];
  readonly asyncBoundaries: readonly string[];
  readonly errorPaths: readonly string[];
}

export interface ReviewBasisHypothesis {
  readonly hypothesisId: string;
  readonly statement: string;
  readonly triggerCondition: string;
}

export interface ReviewBasisMissingInformation {
  readonly description: string;
  readonly whyItMatters: string;
}

export interface ReviewBasisEvidenceRef {
  readonly evidenceId: string;
  readonly sourceType: string;
  readonly location: string;
  readonly summary: string;
}

export interface ReviewBasisV1 {
  readonly filePath: string;
  readonly roleInChangeset: string;
  readonly changedBehavior: readonly ReviewBasisChangedBehavior[];
  readonly facts: readonly ReviewBasisFact[];
  readonly inferences: readonly ReviewBasisInference[];
  readonly dependencyMap: ReviewBasisDependencyMap;
  readonly flowMap: ReviewBasisFlowMap;
  readonly hypothesisLedger: readonly ReviewBasisHypothesis[];
  readonly missingInformation: readonly ReviewBasisMissingInformation[];
  readonly evidenceRefs: readonly ReviewBasisEvidenceRef[];
}

export interface PriorValidatorFeedback {
  readonly failedGates: readonly string[];
  readonly requiredCorrections: readonly string[];
}

export function cloneReviewBasis(input: ReviewBasisV1): ReviewBasisV1 {
  return {
    filePath: input.filePath,
    roleInChangeset: input.roleInChangeset,
    changedBehavior: input.changedBehavior.map((entry) => ({
      before: entry.before,
      after: entry.after,
      evidenceIds: [...entry.evidenceIds]
    })),
    facts: input.facts.map((entry) => ({
      statement: entry.statement,
      evidenceIds: [...entry.evidenceIds]
    })),
    inferences: input.inferences.map((entry) => ({
      statement: entry.statement,
      basedOnEvidenceIds: [...entry.basedOnEvidenceIds],
      confidence: entry.confidence
    })),
    dependencyMap: {
      upstreamCallers: [...input.dependencyMap.upstreamCallers],
      downstreamConsumers: [...input.dependencyMap.downstreamConsumers],
      externalContracts: [...input.dependencyMap.externalContracts],
      sharedStateOrSideEffects: [...input.dependencyMap.sharedStateOrSideEffects]
    },
    flowMap: {
      entryPoints: [...input.flowMap.entryPoints],
      stateTransitions: [...input.flowMap.stateTransitions],
      asyncBoundaries: [...input.flowMap.asyncBoundaries],
      errorPaths: [...input.flowMap.errorPaths]
    },
    hypothesisLedger: input.hypothesisLedger.map((entry) => ({
      hypothesisId: entry.hypothesisId,
      statement: entry.statement,
      triggerCondition: entry.triggerCondition
    })),
    missingInformation: input.missingInformation.map((entry) => ({
      description: entry.description,
      whyItMatters: entry.whyItMatters
    })),
    evidenceRefs: input.evidenceRefs.map((entry) => ({
      evidenceId: entry.evidenceId,
      sourceType: entry.sourceType,
      location: entry.location,
      summary: entry.summary
    }))
  };
}

export function clonePriorValidatorFeedback(
  input: PriorValidatorFeedback
): PriorValidatorFeedback {
  return {
    failedGates: [...input.failedGates],
    requiredCorrections: [...input.requiredCorrections]
  };
}
