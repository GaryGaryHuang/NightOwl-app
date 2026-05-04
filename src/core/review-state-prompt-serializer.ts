import type { FileReviewContext, Finding } from "./file-review-context.ts";
import { buildFindingAnchorValidationContext } from "./finding-anchor-context.ts";
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
import {
  DEPENDENCIES_BOUNDARIES_SECTION_KEY,
  KNOWLEDGE_SOURCE_OF_TRUTH_SECTION_KEY,
  OVERVIEW_SECTION_KEY,
  STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY
} from "./review-section-contract.ts";

export type FindingsBlockKind =
  | "candidate-findings"
  | "approved-findings"
  | "verified-findings"
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
    | "getSection"
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

export interface ReviewStateSnapshotSections {
  overview: string | null;
  boundaryMap: string | null;
  sourcePack: string | null;
  hypothesisPack: string | null;
}

export interface ReviewStateSnapshot {
  schemaVersion: 1;
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
  verifiedFindings: Finding[];
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

    return [
      '<review_state format="json">',
      stringifyForXmlishBlock(snapshot),
      "</review_state>"
    ].join("\n");
  }

  buildSnapshot(input: ReviewStateSerializeInput): ReviewStateSnapshot {
    const anchorContext = buildFindingAnchorValidationContext(
      input.context.filePath,
      input.context.diffContent
    );
    const approvedFindings =
      input.context.getValidationReportV1?.()?.approvedFindings ??
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
      schemaVersion: 1,
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
      verifiedFindings: input.include.includes("verified-findings")
        ? approvedFindings
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
    context: Pick<FileReviewContext, "getSection">
  ): ReviewStateSnapshotSections {
    return {
      overview: context.getSection(OVERVIEW_SECTION_KEY) ?? null,
      boundaryMap: context.getSection(DEPENDENCIES_BOUNDARIES_SECTION_KEY) ?? null,
      sourcePack: context.getSection(KNOWLEDGE_SOURCE_OF_TRUTH_SECTION_KEY) ?? null,
      hypothesisPack:
        context.getSection(STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY) ?? null
    };
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
  return {
    overview: null,
    boundaryMap: null,
    sourcePack: null,
    hypothesisPack: null
  };
}

function stringifyForXmlishBlock(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[<>&]/gu, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      default:
        return char;
    }
  });
}
