import type {
  FileReviewContext,
  Finding,
  FindingTraceability
} from "../file-review-context.ts";
import type { MissingInformationItem } from "../semantic-review.ts";

/**
 * Render the canonical in-memory file state into the Markdown review note shape.
 */
export function renderReviewNote(
  context: Pick<
    FileReviewContext,
    | "filePath"
    | "getSectionEntries"
    | "getFindingsInsertionIndex"
    | "getFindings"
    | "getInterruption"
    | "getMissingInformationItems"
  >
): string {
    const allEntries = context.getSectionEntries();
    const findingsInsertionIndex = context.getFindingsInsertionIndex();
    const findingsSection = renderFindingsSection(
      context.getFindings()
    );
    const missingInformationSection = renderMissingInformationSection(
      context.getMissingInformationItems()
    );
    const warningBlock = renderInterruptionWarning(context.getInterruption());

    let preFindingsSections: string[];
    let postFindingsSections: string[];

    if (findingsInsertionIndex !== undefined) {
      preFindingsSections = allEntries
        .slice(0, findingsInsertionIndex)
        .map(([, content]) => content.trim())
        .filter(Boolean);
      postFindingsSections = allEntries
        .slice(findingsInsertionIndex)
        .map(([, content]) => content.trim())
        .filter(Boolean);
    } else {
      preFindingsSections = allEntries
        .map(([, content]) => content.trim())
        .filter(Boolean);
      postFindingsSections = [];
    }

    // Bootstrap snapshots are intentionally minimal until the first real section lands.
    if (
      preFindingsSections.length === 0 &&
      !findingsSection &&
      postFindingsSections.length === 0
    ) {
      return [
        ...renderFileHeader(context.filePath),
        "- Status: Review not yet generated.",
        ...(warningBlock ? ["", warningBlock] : [])
      ].join("\n");
    }

    return [
      ...renderFileHeader(context.filePath),
      "",
      ...[
        ...preFindingsSections,
        ...(findingsSection ? [findingsSection] : []),
        ...(missingInformationSection ? [missingInformationSection] : []),
        ...postFindingsSections,
        ...(warningBlock ? [warningBlock] : [])
      ].flatMap((section, index) =>
        index === 0 ? [section] : ["", section]
      )
    ].join("\n");
}

export type ReviewNoteRenderer = typeof renderReviewNote;

function renderFileHeader(filePath: string): string[] {
  return [`# ${filePath}`, "", `- Source file: \`${filePath}\``];
}

function renderMissingInformationSection(
  items: MissingInformationItem[] | undefined
): string | undefined {
  if (!items || items.length === 0) {
    return undefined;
  }

  return [
    "## Missing Information",
    ...items.flatMap((item) => [
      `- [${item.itemId}] ${item.description}`,
      `  - Why it matters: ${item.whyItMatters}`
    ])
  ].join("\n");
}

function renderFindingsSection(
  findings: Finding[] | undefined
): string | undefined {
  if (!findings) {
    return undefined;
  }

  if (findings.length === 0) {
    return ["## Findings", "- None"].join("\n");
  }

  const orderedFindings = [
    ...findings.filter((f) => f.priority === "must_fix"),
    ...findings.filter((f) => f.priority === "nice_to_have")
  ];

  return [
    "## Findings",
    ...orderedFindings.flatMap((finding) => [
      `- [${finding.priority}] ${finding.title} (${formatTraceability(finding.traceability)})`,
      `  - Evidence：${finding.evidence}`,
      `  - Trigger Condition：${finding.triggerCondition}`,
      `  - Impact：${finding.impact}`,
      `  - Counter-Evidence：${finding.counterEvidence.join("; ")}`
    ])
  ].join("\n");
}

function formatTraceability(traceability: FindingTraceability): string {
  if (traceability.kind === "diff-hunk") {
    return traceability.hunkHeader;
  }

  if (traceability.kind === "line-range") {
    if (traceability.lineStart === traceability.lineEnd) {
      return `L${traceability.lineStart}`;
    }
    return `L${traceability.lineStart}-L${traceability.lineEnd}`;
  }

  const _exhaustive: never = traceability;
  throw new Error(`unhandled FindingTraceability kind: ${(_exhaustive as FindingTraceability).kind}`);
}

function renderInterruptionWarning(
  interruption: ReturnType<FileReviewContext["getInterruption"]>
): string | undefined {
  if (!interruption) {
    return undefined;
  }

  return [
    "> [!WARNING] Review Interrupted",
    `> This file failed while running ${interruption.stepId} (reason: ${interruption.reason}); later review steps were skipped.`
  ].join("\n");
}
