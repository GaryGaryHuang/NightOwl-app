import type { FileReviewContext } from "./file-review-context.ts";

export type ReviewStateBlock = "sections" | "findings";

export interface ReviewStateSerializeInput {
  context: Pick<FileReviewContext, "getSectionEntries" | "getFindings">;
  include: readonly ReviewStateBlock[];
}

/**
 * Convert FileReviewContext structured state into labeled XML blocks
 * for prompt consumption. Decouples downstream step prompts from
 * ReviewNoteFinalizer Markdown rendering.
 */
export class ReviewStatePromptSerializer {
  serialize(input: ReviewStateSerializeInput): string {
    const parts: string[] = ["<review_state>"];

    if (input.include.includes("sections")) {
      for (const [key, content] of input.context.getSectionEntries()) {
        parts.push(`<section key="${key}">`);
        parts.push(content);
        parts.push("</section>");
      }
    }

    if (input.include.includes("findings")) {
      const findings = input.context.getFindings();

      if (findings !== undefined) {
        parts.push('<findings format="json">');
        parts.push(JSON.stringify(findings, null, 2));
        parts.push("</findings>");
      }
    }

    parts.push("</review_state>");
    return parts.join("\n");
  }
}
