import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewBasis } from "../review-basis.ts";
import type { ReviewSectionKey } from "../review-section-contract.ts";
import type { CandidateFindings } from "../semantic-review.ts";
import type { StepExecutionPlan } from "../step-runner.ts";

export function createCandidateFindingsResolve(input: {
  filePath: string;
  diffContent?: string;
  reviewBasis: ReviewBasis;
  previousCandidateFindings?: CandidateFindings;
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    const validated = services.validator.validateCandidateFindingsWithReport({
      responseText: response,
      reviewBasis: input.reviewBasis,
      ...(input.previousCandidateFindings === undefined
        ? {}
        : { previousCandidateFindings: input.previousCandidateFindings }),
      filePath: input.filePath,
      ...(input.diffContent === undefined
        ? {}
        : { diffContent: input.diffContent })
    });
    return (targetContext: FileReviewContext) => {
      targetContext.setCandidateFindings(validated.payload);
    };
  };
}

export function createValidationReportV1Resolve(input: {
  filePath: string;
  diffContent?: string;
  reviewBasis?: ReviewBasis;
  candidatePayload: CandidateFindings | Record<string, unknown>;
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    const validated = services.validator.validateValidationReportV1WithReport({
      responseText: response,
      candidateFindings: input.candidatePayload,
      ...(input.reviewBasis === undefined ? {} : { reviewBasis: input.reviewBasis }),
      filePath: input.filePath,
      ...(input.diffContent === undefined
        ? {}
        : { diffContent: input.diffContent })
    });
    return (targetContext: FileReviewContext) => {
      targetContext.setValidationReportV1(validated.payload);
      targetContext.setMissingInformationItems(validated.payload.missingInformationItems);
    };
  };
}

/**
 * Factory for the resolve() closure used by Review Summary.
 *
 * Review Summary is user-facing packaging, not a semantic review step. Keep validation
 * lightweight and deterministic: reject only broken packaging before writing the
 * composed Summary.
 */
export function createReviewSummaryResolve(input: {
  stepId: string;
  filePath: string;
  sectionKey: ReviewSectionKey;
  narrativeSections?: readonly ReviewSummaryNarrativeSectionPattern[];
  composeReport?: (response: string) => string;
}): StepExecutionPlan["resolve"] {
  return async (response) => {
    rejectMalformedReviewSummaryNarrative(
      response,
      input.narrativeSections ?? REVIEW_SUMMARY_NARRATIVE_SECTION_PATTERNS
    );
    const sectionContent = input.composeReport?.(response) ?? response;

    return (targetContext: FileReviewContext) => {
      targetContext.setSection(input.sectionKey, sectionContent);
    };
  };
}

export interface ReviewSummaryNarrativeSectionPattern {
  readonly label: string;
  readonly pattern: RegExp;
}

const REVIEW_SUMMARY_NARRATIVE_SECTION_PATTERNS: readonly ReviewSummaryNarrativeSectionPattern[] = [
  { label: "審查依據", pattern: /^#{2,4}\s+審查依據(?:[：:]|\s|$)/mu },
  { label: "行為變更提醒", pattern: /^#{2,4}\s+行為變更提醒(?:[：:]|\s|$)/mu }
];

function rejectMalformedReviewSummaryNarrative(
  response: string,
  narrativeSections: readonly ReviewSummaryNarrativeSectionPattern[]
): void {
  if (response.trim().length === 0) {
    throw new Error("Review Summary narrative response is empty");
  }

  for (const section of narrativeSections) {
    if (!section.pattern.test(response)) {
      throw new Error(
        `Review Summary narrative is missing required section: ${section.label}`
      );
    }
  }
}
