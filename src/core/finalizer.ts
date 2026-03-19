import type { FileReviewContext } from "./file-review-context.ts";

export class ReviewNoteFinalizer {
  render(
    context: Pick<FileReviewContext, "filePath" | "getSection" | "getStructuredState">
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

    if (sections.length === 0 && !findingsSection) {
      return [
        `# ${context.filePath}`,
        "",
        `- Source file: \`${context.filePath}\``,
        "- Status: Review not yet generated."
      ].join("\n");
    }

    return [
      `# ${context.filePath}`,
      "",
      `- Source file: \`${context.filePath}\``,
      "",
      ...[...sections, ...(findingsSection ? [findingsSection] : [])].flatMap((section, index) =>
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

  return [
    "## Findings",
    ...findings.flatMap((finding) => [
      `- [${finding.type}] ${finding.title}`,
      `  - Context：${finding.context}`,
      `  - Deviation：${finding.deviation}`,
      `  - Impact：${finding.impact}`,
      `  - Suggestion：${finding.suggestion}`
    ])
  ].join("\n");
}
