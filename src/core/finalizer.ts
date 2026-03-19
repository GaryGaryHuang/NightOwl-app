import type { FileReviewContext } from "./file-review-context.ts";

export class ReviewNoteFinalizer {
  render(context: Pick<FileReviewContext, "filePath" | "getSection">): string {
    const overview = context.getSection("overview")?.trim();

    if (!overview) {
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
      overview
    ].join("\n");
  }
}
