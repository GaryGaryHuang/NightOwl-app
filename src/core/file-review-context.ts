import type { ReviewSectionKey } from "./review-section-contract.ts";
import { assertReviewSectionKey } from "./review-section-contract.ts";

export interface FileReviewContextInput {
  filePath: string;
  noteFilePath: string;
  diffContent: string;
  baseRef: string;
  headRef: string;
}

export interface Finding {
  type: "must" | "nice";
  title: string;
  context: string;
  deviation: string;
  impact: string;
  suggestion: string;
  confidence: number;
}

export interface ReviewStructuredState {
  findings?: Finding[];
}

export interface ReviewInterruption {
  stepId: string;
  reason: string;
}

export class FileReviewContext {
  readonly filePath: string;
  readonly noteFilePath: string;
  readonly diffContent: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly #sections = new Map<ReviewSectionKey, string>();
  readonly #structuredState: ReviewStructuredState = {};
  #interruption?: ReviewInterruption;

  constructor(input: FileReviewContextInput) {
    this.filePath = input.filePath;
    this.noteFilePath = input.noteFilePath;
    this.diffContent = input.diffContent;
    this.baseRef = input.baseRef;
    this.headRef = input.headRef;
  }

  setSection(sectionKey: string, content: string): void {
    assertReviewSectionKey(sectionKey);
    this.#sections.set(sectionKey, content);
  }

  getSection(sectionKey: string): string | undefined {
    assertReviewSectionKey(sectionKey);
    return this.#sections.get(sectionKey);
  }

  getSectionEntries(): Array<[ReviewSectionKey, string]> {
    return [...this.#sections.entries()];
  }

  updateStructuredState(patch: Partial<ReviewStructuredState>): void {
    if (Object.hasOwn(patch, "findings")) {
      this.#structuredState.findings = patch.findings?.map((finding) => ({
        ...finding
      }));
    }
  }

  getStructuredState(): ReviewStructuredState {
    const findings = this.#structuredState.findings?.map((finding) => ({
      ...finding
    }));

    return findings ? { findings } : {};
  }

  markInterrupted(stepId: string, reason: string): void {
    this.#interruption = { stepId, reason };
  }

  clearInterruption(): void {
    this.#interruption = undefined;
  }

  getInterruption(): ReviewInterruption | undefined {
    return this.#interruption ? { ...this.#interruption } : undefined;
  }
}
