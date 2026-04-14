import type { ReviewSectionKey } from "./review-section-contract.ts";

export interface FileReviewContextInput {
  filePath: string;
  noteFilePath: string;
  diffContent: string;
  baseRef: string;
  headRef: string;
}

export interface FindingLineRangeTraceability {
  kind: "line-range";
  lineStart: number;
  lineEnd: number;
}

export interface FindingDiffHunkTraceability {
  kind: "diff-hunk";
  hunkHeader: string;
}

export type FindingTraceability =
  | FindingLineRangeTraceability
  | FindingDiffHunkTraceability;

export interface Finding {
  type: "must" | "nice";
  title: string;
  traceability: FindingTraceability;
  context: string;
  deviation: string;
  impact: string;
  suggestion: string;
  confidence: number;
}

export interface FindingsPayload {
  findings: Finding[];
}

export interface ReviewStructuredState {
  findings?: Finding[];
}

export interface ReviewInterruption {
  stepId: string;
  reason: string;
}

/**
 * Single-source-of-truth state for one reviewed file.
 * The in-memory state is cloned on reads so snapshots cannot mutate canonical review data.
 */
export class FileReviewContext {
  readonly filePath: string;
  readonly noteFilePath: string;
  readonly diffContent: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly #sections = new Map<string, string>();
  readonly #structuredState: ReviewStructuredState = {};
  #interruption?: ReviewInterruption;
  #findingsInsertionIndex?: number;

  constructor(input: FileReviewContextInput) {
    this.filePath = input.filePath;
    this.noteFilePath = input.noteFilePath;
    this.diffContent = input.diffContent;
    this.baseRef = input.baseRef;
    this.headRef = input.headRef;
  }

  setSection(sectionKey: ReviewSectionKey, content: string): void {
    this.#sections.set(sectionKey, content);
  }

  getSection(sectionKey: ReviewSectionKey): string | undefined {
    return this.#sections.get(sectionKey);
  }

  getSectionEntries(): Array<[string, string]> {
    return [...this.#sections.entries()];
  }

  // Findings are replaced wholesale, not merged, because Step 6 produces the complete final set.
  setFindings(findings: Finding[]): void {
    this.#structuredState.findings = findings.map(cloneFinding);
    this.#findingsInsertionIndex ??= this.#sections.size;
  }

  getFindingsInsertionIndex(): number | undefined {
    return this.#findingsInsertionIndex;
  }

  getStructuredState(): ReviewStructuredState {
    const findings = this.#structuredState.findings?.map(cloneFinding);

    // Return a defensive copy so renderers see the current canonical state without mutating it.
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

function cloneFinding(finding: Finding): Finding {
  const traceability = requireFindingTraceability(finding);

  return {
    ...finding,
    traceability: { ...traceability }
  };
}

function requireFindingTraceability(finding: Finding): FindingTraceability {
  if (!finding.traceability) {
    throw new Error(
      `Formal finding \"${finding.title}\" is missing required traceability.`
    );
  }

  return finding.traceability;
}
