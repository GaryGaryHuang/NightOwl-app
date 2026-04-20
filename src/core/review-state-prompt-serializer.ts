import type { FileReviewContext, Finding } from "./file-review-context.ts";

export type FindingsBlockKind = "candidate-findings" | "verified-findings";

export type ReviewStateBlock = "sections" | FindingsBlockKind;

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

    const findings = input.context.getFindings();

    if (input.include.includes("candidate-findings") && findings !== undefined) {
      parts.push(
        this.serializeFindingsBlock({
          kind: "candidate-findings",
          findings
        })
      );
    }

    if (input.include.includes("verified-findings") && findings !== undefined) {
      parts.push(
        this.serializeFindingsBlock({
          kind: "verified-findings",
          findings
        })
      );
    }

    parts.push("</review_state>");
    return parts.join("\n");
  }

  serializeFindingsBlock(input: {
    kind: FindingsBlockKind;
    findings: readonly Finding[];
  }): string {
    const tagName = input.kind === "candidate-findings"
      ? "candidate_findings"
      : "verified_findings";

    return [
      `<${tagName} format="json">`,
      JSON.stringify(input.findings, null, 2),
      `</${tagName}>`
    ].join("\n");
  }
}
