import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";

export type ReviewStepCapabilityStepId =
  | "changeset-overview"
  | "step1-overview"
  | "step2-dependencies-boundaries"
  | "step3-knowledge-source-of-truth"
  | "step4-strategy-what-if-scenarios"
  | "step5-validation-interrogation"
  | "step6-cognitive-simulation"
  | "step7-summary";

export interface ReviewStepCapability {
  stepId: ReviewStepCapabilityStepId;
  artifactInputs: readonly string[];
  artifactOutputs: readonly string[];
  knowledgeMode: ReviewKnowledgeMode;
  toolProfile: "review-default";
}

export const REVIEW_STEP_CAPABILITIES = [
  {
    stepId: "changeset-overview",
    artifactInputs: ["changeset-entries", "user-context"],
    artifactOutputs: ["change-map", "changeset-overview-markdown"],
    knowledgeMode: "built-in-context7",
    toolProfile: "review-default"
  },
  {
    stepId: "step1-overview",
    artifactInputs: ["change-map", "diff"],
    artifactOutputs: ["file-overview"],
    knowledgeMode: "disabled",
    toolProfile: "review-default"
  },
  {
    stepId: "step2-dependencies-boundaries",
    artifactInputs: ["review-state", "diff"],
    artifactOutputs: ["boundary-map"],
    knowledgeMode: "disabled",
    toolProfile: "review-default"
  },
  {
    stepId: "step3-knowledge-source-of-truth",
    artifactInputs: ["review-state", "diff"],
    artifactOutputs: ["source-pack"],
    knowledgeMode: "built-in-context7",
    toolProfile: "review-default"
  },
  {
    stepId: "step4-strategy-what-if-scenarios",
    artifactInputs: ["review-state"],
    artifactOutputs: ["hypothesis-pack"],
    knowledgeMode: "disabled",
    toolProfile: "review-default"
  },
  {
    stepId: "step5-validation-interrogation",
    artifactInputs: ["review-state", "diff"],
    artifactOutputs: ["candidate-finding-set"],
    knowledgeMode: "disabled",
    toolProfile: "review-default"
  },
  {
    stepId: "step6-cognitive-simulation",
    artifactInputs: ["review-state", "diff", "candidate-findings"],
    artifactOutputs: ["verified-finding-set"],
    knowledgeMode: "disabled",
    toolProfile: "review-default"
  },
  {
    stepId: "step7-summary",
    artifactInputs: ["review-state", "risk-snapshot"],
    artifactOutputs: ["review-summary"],
    knowledgeMode: "disabled",
    toolProfile: "review-default"
  }
] as const satisfies readonly ReviewStepCapability[];

const CAPABILITIES_BY_STEP = new Map(
  REVIEW_STEP_CAPABILITIES.map((entry) => [entry.stepId, entry])
);

export function getReviewStepCapability(
  stepId: ReviewStepCapabilityStepId
): ReviewStepCapability {
  const capability = CAPABILITIES_BY_STEP.get(stepId);

  if (!capability) {
    throw new Error(`Unknown review step capability: ${stepId}`);
  }

  return capability;
}

export function findReviewStepCapability(
  stepId: string
): ReviewStepCapability | undefined {
  return CAPABILITIES_BY_STEP.get(stepId as ReviewStepCapabilityStepId);
}

export function resolveReviewKnowledgeMode(
  stepId: string,
  explicitKnowledgeMode?: ReviewKnowledgeMode
): ReviewKnowledgeMode {
  if (explicitKnowledgeMode) {
    return explicitKnowledgeMode;
  }

  const capability = findReviewStepCapability(stepId);

  if (!capability) {
    throw new Error(`Unknown review step capability: ${stepId}`);
  }

  return capability.knowledgeMode;
}