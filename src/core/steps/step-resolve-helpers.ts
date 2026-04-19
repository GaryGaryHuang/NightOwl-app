import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewSectionKey } from "../review-section-contract.ts";
import type { StepExecutionPlan } from "../step-runner.ts";

/**
 * Factory for the resolve() closure shared by all section steps (Step 1–4, 7).
 *
 * Calls judgeService.evaluate() with the given criteria; on pass, returns a
 * deferred mutation that writes the response to the designated section key.
 */
export function createSectionResolve(input: {
  stepId: string;
  filePath: string;
  sectionKey: ReviewSectionKey;
  criteria: string;
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    if (!services.judgeService) {
      throw new Error("judge service is not configured");
    }

    const judgeResult = await services.judgeService.evaluate({
      stepId: input.stepId,
      filePath: input.filePath,
      criteria: input.criteria,
      sectionContent: response
    });

    if (!judgeResult.passed) {
      throw new Error(judgeResult.cause ?? "judge rejected");
    }

    return (targetContext: FileReviewContext) => {
      targetContext.setSection(input.sectionKey, response);
    };
  };
}

/**
 * Factory for the resolve() closure shared by all structured steps (Step 5, 6).
 *
 * Runs deterministic validation + confidence filtering, then returns a
 * deferred mutation that writes the validated findings to the context.
 */
export function createStructuredResolve(input: {
  filePath: string;
  diffContent?: string;
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    const validated = services.validator.validate({
      responseText: response,
      filePath: input.filePath,
      ...(input.diffContent === undefined
        ? {}
        : { diffContent: input.diffContent })
    });
    const payload = services.validator.filterByAcceptance(validated);

    return (targetContext: FileReviewContext) => {
      targetContext.setFindings(payload.findings);
    };
  };
}
