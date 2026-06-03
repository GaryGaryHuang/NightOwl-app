import type {
  OutputTarget,
  PlannedNoteFile
} from "../review-path-resolver.ts";
import {
  countMustFindings,
  countNiceFindings
} from "../risk-level.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";
import {
  renderCleanFilesSection,
  renderFilesRequiringAttentionSection,
  renderSkippedFilesSection
} from "./run-summary-section.ts";

interface ReviewIndexRenderInput {
  changesetOverviewMarkdown: string;
  outputTarget: OutputTarget;
  plannedNotes: PlannedNoteFile[];
  resolvedOutcomes: ResolvedFileOutcome[];
}

/**
 * Render the run index with review overview, change context, and reviewed-file sections.
 */
export function renderReviewIndex(input: ReviewIndexRenderInput): string {
    const resolvedOutcomes = input.resolvedOutcomes;
    const successfulOutcomes = resolvedOutcomes.filter(
      (r): r is Extract<ResolvedFileOutcome, { status: "successful" }> =>
        r.status === "successful"
    );

    const successfulCount = successfulOutcomes.length;
    const totalMust = successfulOutcomes.reduce(
      (count, outcome) => count + countMustFindings(outcome.outcome.findings),
      0
    );
    const totalNice = successfulOutcomes.reduce(
      (count, outcome) => count + countNiceFindings(outcome.outcome.findings),
      0
    );
    const changeContext = projectChangeContext(input.changesetOverviewMarkdown);
    const reviewLimitations = formatReviewLimitations(resolvedOutcomes);
    const reviewedFileSectionInput = {
      basePath: input.outputTarget.basePath,
      plannedNotes: input.plannedNotes,
      resolvedOutcomes: input.resolvedOutcomes
    };
    const skippedSection = renderSkippedFilesSection(reviewedFileSectionInput);
    const reviewedFileSections = [
      renderFilesRequiringAttentionSection(reviewedFileSectionInput),
      renderCleanFilesSection(reviewedFileSectionInput)
    ].filter((section): section is string => section !== undefined);

    if (!skippedSection && reviewedFileSections.length === 0) {
      reviewedFileSections.push(["## Clean Files", "- None"].join("\n"));
    }

    return [
      "# Review Index",
      "",
      "## Review Overview",
      `- Findings: must=${totalMust}, nice=${totalNice}`,
      `- Review coverage: ${successfulCount}/${input.plannedNotes.length} files fully reviewed`,
      ...(reviewLimitations ? [`- Review limitations: ${reviewLimitations}`] : []),
      ...(skippedSection ? ["", skippedSection] : []),
      "",
      "## Change Context",
      `- Scope: ${changeContext.scope}`,
      `- Behavior changes: ${changeContext.behaviorChanges}`,
      "",
      ...interleaveSections(reviewedFileSections)
    ].join("\n");
}

export type ReviewIndexRenderer = typeof renderReviewIndex;

function formatReviewLimitations(
  resolvedOutcomes: ResolvedFileOutcome[]
): string | undefined {
  const limitedFileCount = resolvedOutcomes.filter(
    (outcome) => outcome.outcome.semanticReview.missingInformationCount > 0
  ).length;

  if (limitedFileCount === 0) {
    return undefined;
  }

  return limitedFileCount === 1
    ? "1 file has missing information"
    : `${limitedFileCount} files have missing information`;
}

function projectChangeContext(overviewMarkdown: string): {
  scope: string;
  behaviorChanges: string;
} {
  return {
    scope: extractOverviewBulletValue(overviewMarkdown, "Scope") ?? "none recorded",
    behaviorChanges:
      extractOverviewBulletValue(overviewMarkdown, "Behavior changes") ??
      "none recorded"
  };
}

function extractOverviewBulletValue(
  overviewMarkdown: string,
  label: string
): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = overviewMarkdown.match(
    new RegExp(`^- ${escapedLabel}:\\s*(.+)$`, "mu")
  );
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

function interleaveSections(sections: string[]): string[] {
  return sections.flatMap((section, index) =>
    index === 0 ? [section] : ["", section]
  );
}
