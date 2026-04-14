export type BuiltinReviewSectionKey =
  | "overview"
  | "dependencies-boundaries"
  | "knowledge-source-of-truth"
  | "strategy-what-if-scenarios"
  | "summary";

export type ReviewSectionKey = string;

export const OVERVIEW_SECTION_KEY = "overview" as const;
export const DEPENDENCIES_BOUNDARIES_SECTION_KEY = "dependencies-boundaries" as const;
export const KNOWLEDGE_SOURCE_OF_TRUTH_SECTION_KEY = "knowledge-source-of-truth" as const;
export const STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY = "strategy-what-if-scenarios" as const;
export const SUMMARY_SECTION_KEY = "summary" as const;
