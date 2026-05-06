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
  "- Build the canonical per-file ReviewBasisV1 JSON object before any findings are generated.",
  "- Build the structured per-file basis required by the ReviewBasisV1 instruction.",
  "- Keep the basis compact and selective so the JSON can be completed and validated; prefer high-signal entries over exhaustive inventories.",
  "- Treat Step 0 ChangeMapReadiness data as authoritative review context for this file.",
  "- Use repository context only to support the structured basis fields. Do not produce findings, final correctness conclusions, candidate findings, approved findings, or remediation advice."
].join("\n");

const REVIEW_BASIS_INSTRUCTION = [
  "Produce a single JSON object using `ReviewBasisV1` for this file.",
  "",
  "Use `<change_map>` and `<diff>` as primary inputs. Retrieve extra repo context only when it is needed to fill evidence-backed basis fields for this file.",
  "",
  "Required top-level fields:",
  "- `roleInChangeset`: this file's specific role in the changeset",
  "- `changedBehavior`: array of `{ before, after, evidenceIds }`",
  "- `facts`: array of `{ statement, evidenceIds }`",
  "- `inferences`: array of `{ statement, basedOnEvidenceIds, confidence }`, where confidence is `high`, `medium`, or `low`",
  "- `dependencyMap`: `{ upstreamCallers, downstreamConsumers, externalContracts, sharedStateOrSideEffects }` (sub-fields may be empty arrays)",
  "- `flowMap`: `{ entryPoints, stateTransitions, asyncBoundaries, errorPaths }` (sub-fields may be empty arrays)",
  "- `testCoverage`: `{ changedTests, observedCoverageSignals, coverageGaps }` (sub-fields may be empty arrays)",
  "- `identifierRegistry`: `{ files, symbols, resourceKeys, apiNames, stateNames }` (sub-fields may be empty arrays)",
  "- `hypothesisLedger`: array of `{ hypothesisId, statement, triggerCondition }`",
  "- `missingInformation`: array of `{ description, whyItMatters }`",
  "- `evidenceRefs`: array of `{ evidenceId, sourceType, location, summary }`",
  "",
  "Identifier and evidence rules:",
  "- Use stable IDs such as `E1`, `INF1`, `H1`.",
  "- `evidenceRefs[].evidenceId` values should be unique.",
  "- Every `evidenceIds` or `basedOnEvidenceIds` value should reference an ID defined in `evidenceRefs`.",
  "- Keep arrays compact: at most 3 entries for changed behaviors, facts, inferences, hypotheses, and missing-information items; at most 8 evidence refs.",
  "",
  "ReviewBasisV1 completion policy:",
  "- Complete a syntactically valid JSON object before expanding breadth or nuance.",
  "- Return compact JSON; whitespace, indentation, and pretty-printing are unnecessary.",
  "- Prefer short single-sentence strings; do not include long code excerpts, tool transcripts, or multi-paragraph explanations.",
  "- If the file has many possible signals, keep the clearest high-signal entries and leave lower-signal arrays empty rather than producing a long object.",
  "- Empty arrays are valid for any array field when there is no direct high-signal evidence; do not add filler solely to populate a field.",
  "- For `dependencyMap`, `flowMap`, `testCoverage`, and `identifierRegistry`, use at most one high-signal string per sub-field unless more detail is essential for a concrete hypothesis.",
  "- Define only evidence refs that are actually referenced by other fields.",
  "",
  "Do not produce findings or include `findings`, `candidateFindings`, `approvedFindings`, or `summary`.",
  "",
  "Minimal shape example:",
  "{",
  "  \"roleInChangeset\": \"Owns the changed review flow behavior.\",",
  "  \"changedBehavior\": [{ \"before\": \"old behavior\", \"after\": \"new behavior\", \"evidenceIds\": [\"E1\"] }],",
  "  \"facts\": [{ \"statement\": \"A concrete observed fact.\", \"evidenceIds\": [\"E1\"] }],",
  "  \"inferences\": [{ \"statement\": \"A bounded inference.\", \"basedOnEvidenceIds\": [\"E1\"], \"confidence\": \"medium\" }],",
  "  \"dependencyMap\": { \"upstreamCallers\": [], \"downstreamConsumers\": [], \"externalContracts\": [], \"sharedStateOrSideEffects\": [] },",
  "  \"flowMap\": { \"entryPoints\": [], \"stateTransitions\": [], \"asyncBoundaries\": [], \"errorPaths\": [] },",
  "  \"testCoverage\": { \"changedTests\": [], \"observedCoverageSignals\": [], \"coverageGaps\": [] },",
  "  \"identifierRegistry\": { \"files\": [\"src/app.ts\"], \"symbols\": [], \"resourceKeys\": [], \"apiNames\": [], \"stateNames\": [] },",
  "  \"hypothesisLedger\": [{ \"hypothesisId\": \"H1\", \"statement\": \"A testable risk hypothesis.\", \"triggerCondition\": \"runtime condition\" }],",
  "  \"missingInformation\": [],",
  "  \"evidenceRefs\": [{ \"evidenceId\": \"E1\", \"sourceType\": \"diff\", \"location\": \"src/app.ts\", \"summary\": \"Relevant diff evidence\" }]",
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
