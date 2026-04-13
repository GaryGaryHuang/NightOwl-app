export const DRY_RUN_REVIEW_STEP_CONTRACTS = [
  "changeset-overview",
  "overview",
  "dependencies-boundaries",
  "knowledge-source-of-truth",
  "strategy-what-if-scenarios",
  "validation-interrogation",
  "cognitive-simulation",
  "summary"
] as const;

export type BuiltinDryRunReviewStepContract =
  (typeof DRY_RUN_REVIEW_STEP_CONTRACTS)[number];

// Dry-run contracts stay string-based so custom steps can opt in without editing
// a central union. Built-in steps still use the canonical catalog above.
export type DryRunReviewStepContract = string;

export function isDryRunReviewStepContract(
  value: string
): value is BuiltinDryRunReviewStepContract {
  return (DRY_RUN_REVIEW_STEP_CONTRACTS as readonly string[]).includes(value);
}
