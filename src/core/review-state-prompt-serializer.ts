import type { FileReviewContext, Finding } from "./file-review-context.ts";
import { buildFindingAnchorPromptContext } from "./finding-anchor-context.ts";
import type {
  PriorValidatorFeedback,
  ReviewBasisEvidenceRef,
  ReviewBasisHypothesis,
  ReviewBasisV1
} from "./review-basis.ts";
import type {
  CandidateFindings,
  MissingInformationItem,
  ValidationReportV1
} from "./semantic-review.ts";
import { buildXmlishJsonBlock } from "./prompt-serialization.ts";
import {
  CANDIDATE_FINDINGS_STEP_ID,
  REVIEW_BASIS_STEP_ID
} from "./review-step-ids.ts";

export type FindingsBlockKind =
  | typeof CANDIDATE_FINDINGS_STEP_ID
  | "approved-findings"
  | "missing-information";

export type ReviewStateBlock =
  | "sections"
  | typeof REVIEW_BASIS_STEP_ID
  | "validation-feedback"
  | "validation-report"
  | FindingsBlockKind;

export interface ReviewStateSerializeInput {
  context: Pick<
    FileReviewContext,
    | "baseRef"
    | "diffContent"
    | "filePath"
    | "getCandidateFindings"
    | "getFindings"
    | "getMissingInformationItems"
    | "getPriorValidatorFeedback"
    | "getReviewBasis"
    | "getSectionEntries"
    | "getValidationReportV1"
    | "headRef"
  >;
  include: readonly ReviewStateBlock[];
}

export interface ReviewStateSnapshotHunk {
  hunkHeader: string;
  headLineStart: number;
  headLineEnd: number;
  changedHeadLines: number[];
}

export type ReviewStateSnapshotSections = Record<string, string>;

export interface ReviewStateSnapshot {
  filePath: string;
  baseRef: string;
  headRef: string;
  diffSummary: {
    hunks: ReviewStateSnapshotHunk[];
  };
  sections: ReviewStateSnapshotSections;
  candidateFindings: CandidateFindings | null;
  approvedFindings: Finding[];
  missingInformationItems: MissingInformationItem[];
  validationReport: ValidationReportV1 | null;
  reviewBasis: ReviewBasisV1 | null;
  evidenceRefs: ReviewBasisEvidenceRef[];
  hypothesisLedger: ReviewBasisHypothesis[];
  validationFeedback: PriorValidatorFeedback | null;
}

/**
 * Convert FileReviewContext canonical state into one host-generated JSON
 * snapshot for prompt consumption. This stays independent from
 * ReviewNoteFinalizer Markdown rendering.
 */
export class ReviewStatePromptSerializer {
  serialize(input: ReviewStateSerializeInput): string {
    const snapshot = this.buildSnapshot(input);

    return buildXmlishJsonBlock("review_state", snapshot).join("\n");
  }

  buildSnapshot(input: ReviewStateSerializeInput): ReviewStateSnapshot {
    const anchorContext = buildFindingAnchorPromptContext(
      input.context.filePath,
      input.context.diffContent
    );
    const approvedFindings =
      input.context.getFindings() ??
      [];
    const candidateFindings =
      input.context.getCandidateFindings?.() ?? null;
    const missingInformationItems =
      input.context.getMissingInformationItems?.() ??
      input.context.getValidationReportV1?.()?.missingInformationItems ??
      [];
    const reviewBasis = input.context.getReviewBasis?.();
    const includeReviewBasis = input.include.includes(REVIEW_BASIS_STEP_ID);

    return {
      filePath: input.context.filePath,
      baseRef: input.context.baseRef,
      headRef: input.context.headRef,
      diffSummary: {
        hunks: anchorContext.diffAnchorMap.hunks.map((hunk) => ({
          hunkHeader: hunk.hunkHeader,
          headLineStart: hunk.headLineStart,
          headLineEnd: hunk.headLineEnd,
          changedHeadLines: [...hunk.changedHeadLines].sort((a, b) => a - b)
        }))
      },
      sections: input.include.includes("sections")
        ? this.buildSections(input.context)
        : emptySections(),
      candidateFindings: input.include.includes(CANDIDATE_FINDINGS_STEP_ID)
        ? candidateFindings
        : null,
      approvedFindings: input.include.includes("approved-findings")
        ? approvedFindings
        : [],
      missingInformationItems: input.include.includes("missing-information")
        ? missingInformationItems
        : [],
      validationReport: input.include.includes("validation-report")
        ? input.context.getValidationReportV1?.() ?? null
        : null,
      reviewBasis: includeReviewBasis ? reviewBasis ?? null : null,
      evidenceRefs: includeReviewBasis && reviewBasis
        ? [...reviewBasis.evidenceRefs]
        : [],
      hypothesisLedger: includeReviewBasis && reviewBasis
        ? [...reviewBasis.hypothesisLedger]
        : [],
      validationFeedback: input.include.includes("validation-feedback")
        ? input.context.getPriorValidatorFeedback?.() ?? null
        : null
    };
  }

  private buildSections(
    context: Pick<FileReviewContext, "getSectionEntries">
  ): ReviewStateSnapshotSections {
    return Object.fromEntries(context.getSectionEntries());
  }

}
function emptySections(): ReviewStateSnapshotSections {
  return {};
}
