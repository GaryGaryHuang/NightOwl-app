import type { FileReviewContext } from "../file-review-context.ts";
import {
  ReviewBasisValidator,
  type ReviewBasisValidationResult
} from "../review-basis-validator.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import type { RunContext } from "../run-context.ts";
import type { StepDefinition, StepExecutionPlan } from "../step-runner.ts";
import { buildXmlishJsonBlock } from "../prompt-serialization.ts";
import {
  JSON_STEP_SYSTEM_MESSAGE,
  MISSING_INFORMATION_DISCIPLINE_BLOCK
} from "./shared-step-system-blocks.ts";

const REVIEW_BASIS_SYSTEM_ADDITION = [
  "## Current Step: ReviewBasis",
  "- Build the canonical per-file JSON basis required by the ReviewBasisV1 instruction.",
  "- Keep the basis compact, selective, and high-signal.",
  "- Treat the provided `<change_map>` data as authoritative review context for this file.",
  "- Use only the provided `<change_map>`, `<diff>`, and local repository context to support the structured basis fields."
].join("\n");

const REVIEW_BASIS_INSTRUCTION = [
  "Produce a single JSON object using `ReviewBasisV1` for this file.",
  "",
  "Retrieve extra local repository context only when needed to fill evidence-backed basis fields for this file.",
  "",
  "Required output top-level fields:",
  "- `roleInChangeset`: this file's specific role in the changeset",
  "- `changedBehavior`: array of `{ before, after, evidenceIds }`, where `evidenceIds` reference `E*` evidence IDs",
  "- `facts`: array of `{ statement, evidenceIds }`, where `evidenceIds` reference `E*` evidence IDs",
  "- `inferences`: array of `{ statement, basedOnEvidenceIds, confidence }`, where `basedOnEvidenceIds` reference `E*` evidence IDs and confidence is `high`, `medium`, or `low`",
  "- `dependencyMap`: `{ upstreamCallers, downstreamConsumers, externalContracts, sharedStateOrSideEffects }` (sub-fields may be empty arrays)",
  "- `flowMap`: `{ entryPoints, stateTransitions, asyncBoundaries, errorPaths }` (sub-fields may be empty arrays)",
  "- `testCoverage`: `{ changedTests, observedCoverageSignals, coverageGaps }` (sub-fields may be empty arrays)",
  "- `hypothesisLedger`: array of `{ hypothesisId, statement, triggerCondition }`, where `hypothesisId` uses `H*` IDs",
  "- `missingInformation`: array of `{ description, whyItMatters }`",
  "- `evidenceRefs`: array of `{ evidenceId, sourceType, location, summary }`",
  "",
  "Non-empty array item shapes:",
  "- `changedBehavior`: `{ \"before\": \"old behavior\", \"after\": \"new behavior\", \"evidenceIds\": [\"E1\"] }`",
  "- `facts`: `{ \"statement\": \"Concrete observed fact.\", \"evidenceIds\": [\"E1\"] }`",
  "- `inferences`: `{ \"statement\": \"Bounded inference.\", \"basedOnEvidenceIds\": [\"E1\"], \"confidence\": \"medium\" }`",
  "- `hypothesisLedger`: `{ \"hypothesisId\": \"H1\", \"statement\": \"Testable review hypothesis.\", \"triggerCondition\": \"runtime condition\" }`",
  "- `missingInformation`: `{ \"description\": \"Missing fact.\", \"whyItMatters\": \"Why this blocks reliable judgment.\" }`",
  "- `evidenceRefs`: `{ \"evidenceId\": \"E1\", \"sourceType\": \"diff\", \"location\": \"src/app.ts\", \"summary\": \"Relevant evidence.\" }`",
  "",
  "Evidence, ID, and entry rules:",
  "- Use stable IDs: `E1`, `E2`, ... for `evidenceRefs[].evidenceId`; `H1`, `H2`, ... for `hypothesisLedger[].hypothesisId`.",
  "- `evidenceRefs[].evidenceId` values should be unique.",
  "- Every `evidenceIds` or `basedOnEvidenceIds` value should reference an ID defined in `evidenceRefs`.",
  "- Keep changed behaviors, facts, inferences, and hypotheses compact; include only high-signal entries needed for downstream finding generation.",
  "- Keep `missingInformation` empty unless a specific missing fact materially blocks reliable downstream finding generation.",
  "- Add an entry only when it captures a distinct behavior change, concrete review hypothesis, or evidence-backed constraint needed by downstream finding generation.",
  "- Define only `evidenceRefs[]` items referenced by high-signal `changedBehavior`, `facts`, or `inferences` entries; do not define unused evidence refs.",
  "- Prefer consolidating related facts that rely on the same evidence.",
  "",
  "ReviewBasisV1 completion policy:",
  "- Prioritize a complete, valid JSON object with the highest-signal evidence before adding lower-priority breadth or nuance.",
  "- Return compact JSON; whitespace, indentation, and pretty-printing are unnecessary.",
  "- Prefer short single-sentence strings; do not include long code excerpts, tool transcripts, or multi-paragraph explanations.",
  "- If the file has many possible signals, keep the clearest entries that preserve distinct review-relevant behaviors or hypotheses; omit repetitive or low-signal entries.",
  "- Empty arrays are valid for any array field when there is no direct high-signal evidence; do not add filler solely to populate a field.",
  "- For `dependencyMap`, `flowMap`, and `testCoverage`, keep each sub-field compact: use an empty array when there is no direct high-signal information; otherwise include only the clearest string unless another distinct string is essential to a concrete hypothesis.",
  "",
  "Minimal valid shape example:",
  "{",
  "  \"roleInChangeset\": \"Owns the changed review flow behavior.\",",
  "  \"changedBehavior\": [],",
  "  \"facts\": [],",
  "  \"inferences\": [],",
  "  \"dependencyMap\": { \"upstreamCallers\": [], \"downstreamConsumers\": [], \"externalContracts\": [], \"sharedStateOrSideEffects\": [] },",
  "  \"flowMap\": { \"entryPoints\": [], \"stateTransitions\": [], \"asyncBoundaries\": [], \"errorPaths\": [] },",
  "  \"testCoverage\": { \"changedTests\": [], \"observedCoverageSignals\": [], \"coverageGaps\": [] },",
  "  \"hypothesisLedger\": [],",
  "  \"missingInformation\": [],",
  "  \"evidenceRefs\": []",
  "}"
].join("\n");

export interface ReviewBasisStepOptions {
  runContext: RunContext;
  validator?: Pick<ReviewBasisValidator, "validate">;
}

export class ReviewBasisStep implements StepDefinition {
  readonly stepId = "review-basis";
  readonly #runContext: RunContext;
  readonly #validator: Pick<ReviewBasisValidator, "validate">;

  constructor(options: ReviewBasisStepOptions) {
    this.#runContext = options.runContext;
    this.#validator = options.validator ?? new ReviewBasisValidator();
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    return {
      stepId: this.stepId,
      prompt: {
        systemMessage: [
          JSON_STEP_SYSTEM_MESSAGE,
          MISSING_INFORMATION_DISCIPLINE_BLOCK.content,
          REVIEW_BASIS_SYSTEM_ADDITION
        ].join("\n\n"),
        userMessage: buildReviewBasisUserMessage(context, this.#runContext)
      },
      reviewProfile: {
        knowledgeMode: "built-in-context7",
        model: "gpt-5.4-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
      },
      resolve: async (response) => {
        return this.#resolveValidatedReviewBasis(response, context);
      }
    };
  }

  #resolveValidatedReviewBasis(
    response: string,
    context: FileReviewContext
  ): Promise<(context: FileReviewContext) => void> {
    const result: ReviewBasisValidationResult = this.#validator.validate({
      responseText: response,
      filePath: context.filePath
    });
    if (!result.ok) {
      throw new Error(
        `ReviewBasis validation failed: ${result.diagnostics.map((d) => d.message).join("; ")}`
      );
    }
    const reviewBasis = result.value;
    return Promise.resolve((targetContext: FileReviewContext) => {
      targetContext.setReviewBasis(reviewBasis);
    });
  }
}

function buildReviewBasisUserMessage(
  context: FileReviewContext,
  runContext: RunContext
): string {
  return [
    ...buildXmlishJsonBlock("change_map", runContext.changesetOverview),
    "",
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    REVIEW_BASIS_INSTRUCTION
  ].join("\n");
}
