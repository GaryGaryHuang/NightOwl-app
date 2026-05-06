import type { FileReviewContext, Finding } from "./file-review-context.ts";
import { buildFindingAnchorPromptContext } from "./finding-anchor-context.ts";
import type {
  PriorValidatorFeedback,
  ReviewBasisEvidenceRef,
  ReviewBasisHypothesis,
  ReviewBasisIdentifierRegistry,
  ReviewBasisV1
} from "./review-basis.ts";
import type {
  CandidateFindingsV3,
  MissingInformationItem
} from "./semantic-review.ts";
import { buildXmlishJsonBlock } from "./prompt-serialization.ts";

export type FindingsBlockKind =
  | "candidate-findings"
  | "approved-findings"
  | "missing-information";

export type ReviewStateBlock =
  | "sections"
  | "review-basis"
  | "validation-feedback"
  | FindingsBlockKind;

export interface ReviewStateSerializeInput {
  context: Pick<
    FileReviewContext,
    | "baseRef"
    | "diffContent"
    | "filePath"
    | "getCandidateFindingsV3"
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
  candidateFindings: CandidateFindingsV3 | null;
  approvedFindings: Finding[];
  missingInformationItems: MissingInformationItem[];
  reviewBasis: ReviewBasisV1 | null;
  evidenceRefs: ReviewBasisEvidenceRef[];
  identifierRegistry: ReviewBasisIdentifierRegistry;
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
      input.context.getCandidateFindingsV3?.() ?? null;
    const missingInformationItems =
      input.context.getMissingInformationItems?.() ??
      input.context.getValidationReportV1?.()?.missingInformationItems ??
      [];
    const reviewBasis = input.context.getReviewBasis?.();
    const includeReviewBasis = input.include.includes("review-basis");

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
      candidateFindings: input.include.includes("candidate-findings")
        ? candidateFindings
        : null,
      approvedFindings: input.include.includes("approved-findings")
        ? approvedFindings
        : [],
      missingInformationItems: input.include.includes("missing-information")
        ? missingInformationItems
        : [],
      reviewBasis: includeReviewBasis ? reviewBasis ?? null : null,
      evidenceRefs: includeReviewBasis && reviewBasis
        ? [...reviewBasis.evidenceRefs]
        : [],
      identifierRegistry: includeReviewBasis && reviewBasis
        ? reviewBasis.identifierRegistry
        : emptyIdentifierRegistry(),
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

function emptyIdentifierRegistry(): ReviewBasisIdentifierRegistry {
  return {
    files: [],
    symbols: [],
    resourceKeys: [],
    apiNames: [],
    stateNames: []
  };
}

function emptySections(): ReviewStateSnapshotSections {
  return {};
}
