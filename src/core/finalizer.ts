import type { FileReviewContext } from "./file-review-context.ts";

export class ReviewNoteFinalizer {
  render(
    context: Pick<
      FileReviewContext,
      "filePath" | "getSection" | "getStructuredState" | "getInterruption"
    >
  ): string {
    const sections = [
      "overview",
      "dependencies-boundaries",
      "knowledge-source-of-truth",
      "strategy-what-if-scenarios"
    ]
      .map((sectionKey) => context.getSection(sectionKey)?.trim())
      .filter((section): section is string => Boolean(section));
    const findingsSection = renderFindingsSection(
      context.getStructuredState().findings
    );
    const summarySection = context.getSection("summary")?.trim();
    const warningBlock = renderInterruptionWarning(context.getInterruption());

    if (sections.length === 0 && !findingsSection && !summarySection && !warningBlock) {
      return [
        `# ${context.filePath}`,
        "",
        `- Source file: \`${context.filePath}\``,
        "- Status: Review not yet generated."
      ].join("\n");
    }

    if (sections.length === 0 && !findingsSection && !summarySection && warningBlock) {
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
        ...sections,
        ...(findingsSection ? [findingsSection] : []),
        ...(summarySection ? [summarySection] : []),
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
    return ["## Findings", "無 findings.", "- 無"].join("\n");
  }

  const mustFindings = findings.filter((f) => f.type === "must");
  const niceFindings = findings.filter((f) => f.type === "nice");
  const statsLine = `${mustFindings.length} must-fix issue(s), ${niceFindings.length} nice-to-have suggestion(s).`;

  return [
    "## Findings",
    statsLine,
    ...[...mustFindings, ...niceFindings].flatMap((finding) => [
      `- [${finding.type}] ${finding.title}`,
      `  - Context：${finding.context}`,
      `  - Deviation：${finding.deviation}`,
      `  - Impact：${finding.impact}`,
      `  - Suggestion：${finding.suggestion}`
    ])
  ].join("\n");
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
