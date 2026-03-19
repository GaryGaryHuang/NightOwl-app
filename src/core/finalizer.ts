import type { FileReviewContext } from "./file-review-context.ts";

export class ReviewNoteFinalizer {
  render(context: Pick<FileReviewContext, "filePath" | "getSection">): string {
    const sections = [
      "overview",
      "dependencies-boundaries",
      "knowledge-source-of-truth",
      "strategy-what-if-scenarios"
    ]
      .map((sectionKey) => context.getSection(sectionKey)?.trim())
      .filter((section): section is string => Boolean(section));

    if (sections.length === 0) {
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
      ...sections.flatMap((section, index) =>
        index === 0 ? [section] : ["", section]
      )
    ].join("\n");
  }
}
