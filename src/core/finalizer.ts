import type {
  FileReviewContext,
  FindingTraceability
} from "./file-review-context.ts";
import { getReviewSectionDefinitionsForSlot } from "./review-section-contract.ts";

export class ReviewNoteFinalizer {
  render(
    context: Pick<
      FileReviewContext,
      "filePath" | "getSection" | "getStructuredState" | "getInterruption"
    >
  ): string {
    const preFindingsSections = getReviewSectionDefinitionsForSlot("pre-findings")
      .map((definition) => context.getSection(definition.key)?.trim())
      .filter((section): section is string => Boolean(section));
    const findingsSection = renderFindingsSection(
      context.getStructuredState().findings
    );
    const postFindingsSections = getReviewSectionDefinitionsForSlot("post-findings")
      .map((definition) => context.getSection(definition.key)?.trim())
      .filter((section): section is string => Boolean(section));
    const warningBlock = renderInterruptionWarning(context.getInterruption());

    if (
      preFindingsSections.length === 0 &&
      !findingsSection &&
      postFindingsSections.length === 0 &&
      !warningBlock
    ) {
      return [
        `# ${context.filePath}`,
        "",
        `- Source file: \`${context.filePath}\``,
        "- Status: Review not yet generated."
      ].join("\n");
    }

    if (
      preFindingsSections.length === 0 &&
      !findingsSection &&
      postFindingsSections.length === 0 &&
      warningBlock
    ) {
      return [
        `# ${context.filePath}`,
        "",
        `- Source file: \`${context.filePath}\``,
        "- Status: Review not yet generated.",
        "",
        warningBlock
      ].join("\n");
    }

    return [
      `# ${context.filePath}`,
      "",
      `- Source file: \`${context.filePath}\``,
      "",
      ...[
        ...preFindingsSections,
        ...(findingsSection ? [findingsSection] : []),
        ...postFindingsSections,
        ...(warningBlock ? [warningBlock] : [])
      ].flatMap((section, index) =>
        index === 0 ? [section] : ["", section]
      )
    ].join("\n");
  }
}

function renderFindingsSection(
  findings: ReturnType<FileReviewContext["getStructuredState"]>["findings"]
): string | undefined {
  if (!findings) {
    return undefined;
  }

  if (findings.length === 0) {
    return ["## Findings", "- 無"].join("\n");
  }

  const mustFindings = findings.filter((f) => f.type === "must");
  const niceFindings = findings.filter((f) => f.type === "nice");
  const statsLine = `${mustFindings.length} must-fix issue(s), ${niceFindings.length} nice-to-have suggestion(s).`;

  return [
    "## Findings",
    statsLine,
    ...[...mustFindings, ...niceFindings].flatMap((finding) => [
      `- [${finding.type}] ${finding.title}`,
      `  - Traceability: ${formatTraceability(finding.traceability)}`,
      `  - Context：${finding.context}`,
      `  - Deviation：${finding.deviation}`,
      `  - Impact：${finding.impact}`,
      `  - Suggestion：${finding.suggestion}`
    ])
  ].join("\n");
}

function formatTraceability(traceability: FindingTraceability): string {
  if (traceability.kind === "diff-hunk") {
    return traceability.hunkHeader;
  }

  if (traceability.lineStart === traceability.lineEnd) {
    return `L${traceability.lineStart}`;
  }

  return `L${traceability.lineStart}-L${traceability.lineEnd}`;
}

function renderInterruptionWarning(
  interruption: ReturnType<FileReviewContext["getInterruption"]>
): string | undefined {
  if (!interruption) {
    return undefined;
  }

  return [
    "> [!WARNING] Review Interrupted",
    `> 本檔案在執行 ${interruption.stepId} 時失敗（原因：${interruption.reason}），後續審查已略過。`
  ].join("\n");
}
