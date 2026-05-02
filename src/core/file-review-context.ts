import type { ReviewSectionKey } from "./review-section-contract.ts";
import type { VerifierReportArtifactEntry } from "./verifier-report.ts";

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

export type EvidenceSupportRole =
  | "expectedBehavior"
  | "actualBehavior"
  | "reachability"
  | "impact";

export interface EvidenceRef {
  evidenceRef: string;
  supports: EvidenceSupportRole;
}

export interface Reachability {
  credible: boolean;
  entryPoint: string;
  guardsChecked: string[];
  description?: string;
}

export type UncertaintyStatus = "supported" | "tentative" | "unsupported" | "out_of_scope";

export type VerifierVerdictCheckName =
  | "anchor"
  | "evidence"
  | "reachability"
  | "impact"
  | "scope"
  | "duplicate";

export type VerifierVerdictCheckResult = "pass";

export interface VerifierVerdict {
  status: "accepted";
  checks: Record<VerifierVerdictCheckName, VerifierVerdictCheckResult>;
}

export interface DependencyAnchor {
  filePath: string;
  symbol?: string;
}

/**
 * Optional structural marker declaring that a finding's anchor intentionally
 * sits outside the diff's changed lines because it points to a dependency path
 * that is causally linked to the change. M2 carries the field shape only;
 * deeper evidence semantics arrive in later milestones.
 */
export interface DependencyPathException {
  reason: string;
  dependencyAnchor: DependencyAnchor;
}

export interface Finding {
  type: "must" | "nice";
  title: string;
  traceability: FindingTraceability;
  expectedBehavior: string;
  actualBehavior: string;
  deviation: string;
  impact: string;
  suggestion: string;
  dependencyPathException?: DependencyPathException;
  findingId: string;
  supportingEvidence: EvidenceRef[];
  reachability: Reachability;
  uncertaintyStatus: UncertaintyStatus;
  verifierVerdict?: VerifierVerdict;
  sourceHypothesisId?: string;
}

export interface FindingsPayload {
  schemaVersion: 2;
  findings: Finding[];
}

export type DispositionStatus = "retained" | "modified" | "retired";

export type DispositionReason =
  | "SUPPORTED"
  | "ANCHOR"
  | "EVIDENCE"
  | "REACHABILITY"
  | "OUT_OF_SCOPE"
  | "DUPLICATE"
  | "CONTRADICTION";

export interface FindingDisposition {
  findingId: string;
  status: DispositionStatus;
  reason: DispositionReason;
  explanation: string;
}

export interface VerifiedFindingsPayload {
  schemaVersion: 2;
  findings: Finding[];
  dispositions: FindingDisposition[];
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
  #findings?: Finding[];
  #dispositions?: FindingDisposition[];
  #verifierReportEntries?: VerifierReportArtifactEntry[];
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
    this.#findings = findings.map(cloneFinding);
    this.#findingsInsertionIndex ??= this.#sections.size;
  }

  getFindingsInsertionIndex(): number | undefined {
    return this.#findingsInsertionIndex;
  }

  getFindings(): Finding[] | undefined {
    return this.#findings?.map(cloneFinding);
  }

  setDispositions(dispositions: FindingDisposition[]): void {
    this.#dispositions = dispositions.map(cloneDisposition);
  }

  getDispositions(): FindingDisposition[] | undefined {
    return this.#dispositions ? this.#dispositions.map(cloneDisposition) : undefined;
  }

  appendVerifierReportEntries(entries: VerifierReportArtifactEntry[]): void {
    if (entries.length === 0) {
      return;
    }

    const existing = this.#verifierReportEntries ?? [];
    this.#verifierReportEntries = [
      ...existing.map(cloneVerifierReportArtifactEntry),
      ...entries.map(cloneVerifierReportArtifactEntry)
    ];
  }

  getVerifierReportEntries(): VerifierReportArtifactEntry[] | undefined {
    return this.#verifierReportEntries?.map(cloneVerifierReportArtifactEntry);
  }

  markInterrupted(stepId: string, reason: string): void {
    this.#interruption = { stepId, reason };
  }

  getInterruption(): ReviewInterruption | undefined {
    return this.#interruption ? { ...this.#interruption } : undefined;
  }
}

function cloneFinding(finding: Finding): Finding {
  const traceability = requireFindingTraceability(finding);
  const cloned: Finding = {
    ...finding,
    traceability: { ...traceability },
    supportingEvidence: finding.supportingEvidence.map((e) => ({ ...e })),
    reachability: {
      ...finding.reachability,
      guardsChecked: [...finding.reachability.guardsChecked]
    }
  };

  if (finding.dependencyPathException) {
    cloned.dependencyPathException = {
      reason: finding.dependencyPathException.reason,
      dependencyAnchor: { ...finding.dependencyPathException.dependencyAnchor }
    };
  }

  if (finding.verifierVerdict) {
    cloned.verifierVerdict = {
      status: finding.verifierVerdict.status,
      checks: { ...finding.verifierVerdict.checks }
    };
  }

  return cloned;
}

function cloneDisposition(d: FindingDisposition): FindingDisposition {
  return { ...d };
}

function cloneVerifierReportArtifactEntry(
  entry: VerifierReportArtifactEntry
): VerifierReportArtifactEntry {
  return { ...entry };
}

function requireFindingTraceability(finding: Finding): FindingTraceability {
  if (!finding.traceability) {
    throw new Error(
      `Formal finding \"${finding.title}\" is missing required traceability.`
    );
  }

  return finding.traceability;
}
