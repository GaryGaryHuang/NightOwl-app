import { buildDiffAnchorMap } from "./diff-anchor-map.ts";
import type { FileReviewContext, Finding } from "./file-review-context.ts";
import {
  DEPENDENCIES_BOUNDARIES_SECTION_KEY,
  KNOWLEDGE_SOURCE_OF_TRUTH_SECTION_KEY,
  OVERVIEW_SECTION_KEY,
  STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY
} from "./review-section-contract.ts";

export type FindingsBlockKind = "candidate-findings" | "verified-findings";

export type ReviewStateBlock = "sections" | FindingsBlockKind;

export interface ReviewStateSerializeInput {
  context: Pick<
    FileReviewContext,
    | "baseRef"
    | "diffContent"
    | "filePath"
    | "getFindings"
    | "getSection"
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
  candidateFindings: Finding[];
  verifiedFindings: Finding[];
  evidenceRefs: [];
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
    const diffAnchorMap = buildDiffAnchorMap(
      input.context.filePath,
      input.context.diffContent
    );
    const findings = input.context.getFindings() ?? [];

    return {
      schemaVersion: 1,
      filePath: input.context.filePath,
      baseRef: input.context.baseRef,
      headRef: input.context.headRef,
      diffSummary: {
        hunks: diffAnchorMap.hunks.map((hunk) => ({
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
        ? findings
        : [],
      verifiedFindings: input.include.includes("verified-findings")
        ? findings
        : [],
      evidenceRefs: []
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
