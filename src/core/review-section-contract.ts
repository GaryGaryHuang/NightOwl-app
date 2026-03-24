export type ReviewSectionRenderSlot = "pre-findings" | "post-findings";

export interface ReviewSectionDefinition {
  key: string;
  stepId: string;
  renderSlot: ReviewSectionRenderSlot;
  order: number;
}

export interface ReviewSectionContract {
  definitions: readonly ReviewSectionDefinition[];
  definitionsByKey: ReadonlyMap<ReviewSectionKey, ReviewSectionDefinition>;
  definitionsBySlot: Readonly<Record<ReviewSectionRenderSlot, readonly ReviewSectionDefinition[]>>;
}

export const OVERVIEW_SECTION = {
  key: "overview",
  stepId: "step1-overview",
  renderSlot: "pre-findings",
  order: 1
} as const satisfies ReviewSectionDefinition;

export const DEPENDENCIES_BOUNDARIES_SECTION = {
  key: "dependencies-boundaries",
  stepId: "step2-dependencies-boundaries",
  renderSlot: "pre-findings",
  order: 2
} as const satisfies ReviewSectionDefinition;

export const KNOWLEDGE_SOURCE_OF_TRUTH_SECTION = {
  key: "knowledge-source-of-truth",
  stepId: "step3-knowledge-source-of-truth",
  renderSlot: "pre-findings",
  order: 3
} as const satisfies ReviewSectionDefinition;

export const STRATEGY_WHAT_IF_SCENARIOS_SECTION = {
  key: "strategy-what-if-scenarios",
  stepId: "step4-strategy-what-if-scenarios",
  renderSlot: "pre-findings",
  order: 4
} as const satisfies ReviewSectionDefinition;

export const SUMMARY_SECTION = {
  key: "summary",
  stepId: "step7-summary",
  renderSlot: "post-findings",
  order: 1
} as const satisfies ReviewSectionDefinition;

export const REVIEW_SECTION_DEFINITIONS = [
  OVERVIEW_SECTION,
  DEPENDENCIES_BOUNDARIES_SECTION,
  KNOWLEDGE_SOURCE_OF_TRUTH_SECTION,
  STRATEGY_WHAT_IF_SCENARIOS_SECTION,
  SUMMARY_SECTION
] as const satisfies readonly ReviewSectionDefinition[];

export type ReviewSectionKey = (typeof REVIEW_SECTION_DEFINITIONS)[number]["key"];

const REVIEW_SECTION_CONTRACT = buildReviewSectionContract(REVIEW_SECTION_DEFINITIONS);

export function buildReviewSectionContract(
  definitions: readonly ReviewSectionDefinition[]
): ReviewSectionContract {
  const definitionsByKey = new Map<ReviewSectionKey, ReviewSectionDefinition>();
  const preFindings: ReviewSectionDefinition[] = [];
  const postFindings: ReviewSectionDefinition[] = [];

  for (const definition of definitions) {
    validateDefinitionShape(definition);

    const sectionKey = definition.key as ReviewSectionKey;
    if (definitionsByKey.has(sectionKey)) {
      throw new Error(`duplicate section identifier: ${definition.key}`);
    }

    const slotDefinitions =
      definition.renderSlot === "pre-findings" ? preFindings : postFindings;
    if (slotDefinitions.some((entry) => entry.order === definition.order)) {
      throw new Error(
        `duplicate render order ${definition.order} in slot ${definition.renderSlot}`
      );
    }

    const frozenDefinition = Object.freeze({ ...definition });
    definitionsByKey.set(sectionKey, frozenDefinition);
    slotDefinitions.push(frozenDefinition);
  }

  preFindings.sort((left, right) => left.order - right.order);
  postFindings.sort((left, right) => left.order - right.order);

  return Object.freeze({
    definitions: Object.freeze([...definitionsByKey.values()]),
    definitionsByKey,
    definitionsBySlot: Object.freeze({
      "pre-findings": Object.freeze([...preFindings]),
      "post-findings": Object.freeze([...postFindings])
    })
  });
}

export function assertReviewSectionKey(sectionKey: string): asserts sectionKey is ReviewSectionKey {
  if (!REVIEW_SECTION_CONTRACT.definitionsByKey.has(sectionKey as ReviewSectionKey)) {
    throw new Error(`undeclared section identifier: ${sectionKey}`);
  }
}

export function getReviewSectionDefinition(
  sectionKey: ReviewSectionKey
): ReviewSectionDefinition {
  return REVIEW_SECTION_CONTRACT.definitionsByKey.get(sectionKey)!;
}

export function getReviewSectionDefinitionsForSlot(
  slot: ReviewSectionRenderSlot
): readonly ReviewSectionDefinition[] {
  return REVIEW_SECTION_CONTRACT.definitionsBySlot[slot];
}

function validateDefinitionShape(definition: ReviewSectionDefinition): void {
  if (typeof definition.key !== "string" || definition.key.trim() === "") {
    throw new Error("review section definition is missing key");
  }

  if (typeof definition.stepId !== "string" || definition.stepId.trim() === "") {
    throw new Error(`review section definition ${definition.key} is missing stepId`);
  }

  if (
    definition.renderSlot !== "pre-findings" &&
    definition.renderSlot !== "post-findings"
  ) {
    throw new Error(
      `review section definition ${definition.key} uses invalid render slot: ${String(definition.renderSlot)}`
    );
  }

  if (!Number.isInteger(definition.order) || definition.order < 1) {
    throw new Error(
      `review section definition ${definition.key} must use a positive integer render order`
    );
  }
}
