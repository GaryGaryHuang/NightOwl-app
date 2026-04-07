export type DryRunReviewStepContract =
  | "changeset-overview"
  | "overview"
  | "dependencies-boundaries"
  | "knowledge-source-of-truth"
  | "strategy-what-if-scenarios"
  | "validation-interrogation"
  | "cognitive-simulation"
  | "summary";

export const DRY_RUN_REVIEW_STEP_CONTRACTS = [
  "changeset-overview",
  "overview",
  "dependencies-boundaries",
  "knowledge-source-of-truth",
  "strategy-what-if-scenarios",
  "validation-interrogation",
  "cognitive-simulation",
  "summary"
] as const satisfies readonly DryRunReviewStepContract[];

export function isDryRunReviewStepContract(
  value: string
): value is DryRunReviewStepContract {
  return (DRY_RUN_REVIEW_STEP_CONTRACTS as readonly string[]).includes(value);
}
