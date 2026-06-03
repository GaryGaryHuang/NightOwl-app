import type { ReviewSectionKey } from "./review-section-contract.ts";
import {
  clonePriorValidatorFeedback,
  cloneReviewBasis,
  type PriorValidatorFeedback,
  type ReviewBasis
} from "./review-basis.ts";
import {
  cloneCandidateFindings,
  cloneMissingInformationItems,
  cloneValidationReportV1,
  type CandidateFindings,
  type MissingInformationItem,
  type PerFindingValidationResult,
  type ValidationReportV1
} from "./semantic-review.ts";

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
  findingId: string;
  priority: "must_fix" | "nice_to_have";
  title: string;
  traceability: FindingTraceability;
  evidence: string;
  triggerCondition: string;
  impact: string;
  counterEvidence: string[];
  dependencyPathException?: DependencyPathException;
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
  #interruption?: ReviewInterruption;
  #findingsInsertionIndex?: number;
  #reviewBasis?: ReviewBasis;
  #priorValidatorFeedback?: PriorValidatorFeedback;
  #candidateFindings?: CandidateFindings;
  #validationReportV1?: ValidationReportV1;
  #missingInformationItems?: MissingInformationItem[];
  #accumulatedApprovedFindings: Finding[] = [];

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

  // Final findings are replaced wholesale after Semantic Validation commits the complete set.
  setFindings(findings: Finding[]): void {
    this.#findings = findings.map(cloneFinding);
    this.#findingsInsertionIndex ??= this.#sections.size;
  }

  getFindingsInsertionIndex(): number | undefined {
    return this.#findingsInsertionIndex;
  }

  setReviewBasis(reviewBasis: ReviewBasis): void {
    this.#reviewBasis = cloneReviewBasis(reviewBasis);
  }

  getReviewBasis(): ReviewBasis | undefined {
    return this.#reviewBasis ? cloneReviewBasis(this.#reviewBasis) : undefined;
  }

  setPriorValidatorFeedback(feedback: PriorValidatorFeedback): void {
    this.#priorValidatorFeedback = clonePriorValidatorFeedback(feedback);
  }

  getPriorValidatorFeedback(): PriorValidatorFeedback | undefined {
    return this.#priorValidatorFeedback
      ? clonePriorValidatorFeedback(this.#priorValidatorFeedback)
      : undefined;
  }

  setCandidateFindings(payload: CandidateFindings): void {
    this.#candidateFindings = cloneCandidateFindings(payload);
  }

  getCandidateFindings(): CandidateFindings | undefined {
    return this.#candidateFindings
      ? cloneCandidateFindings(this.#candidateFindings)
      : undefined;
  }

  setValidationReportV1(report: ValidationReportV1): void {
    this.#validationReportV1 = cloneValidationReportV1(report);
  }

  getValidationReportV1(): ValidationReportV1 | undefined {
    return this.#validationReportV1
      ? cloneValidationReportV1(this.#validationReportV1)
      : undefined;
  }

  setMissingInformationItems(items: MissingInformationItem[]): void {
    this.#missingInformationItems = cloneMissingInformationItems(items);
  }

  getMissingInformationItems(): MissingInformationItem[] | undefined {
    return this.#missingInformationItems
      ? cloneMissingInformationItems(this.#missingInformationItems)
      : undefined;
  }

  getFindings(): Finding[] | undefined {
    return this.#findings?.map(cloneFinding);
  }

  addAccumulatedApprovedFindings(findings: readonly Finding[]): void {
    this.#accumulatedApprovedFindings.push(...findings.map(cloneFinding));
  }

  getAccumulatedApprovedFindings(): Finding[] {
    return renumberFindings(this.#accumulatedApprovedFindings);
  }

  finalizeAccumulatedApprovedFindings(): void {
    this.setFindings(this.getAccumulatedApprovedFindings());
  }

  markInterrupted(stepId: string, reason: string): void {
    this.#interruption = { stepId, reason };
  }

  getInterruption(): ReviewInterruption | undefined {
    return this.#interruption ? { ...this.#interruption } : undefined;
  }
}

export function clonePerFindingValidationResult(
  result: PerFindingValidationResult
): PerFindingValidationResult {
  return {
    ...result,
    failedGates: [...result.failedGates],
    requiredCorrections: [...result.requiredCorrections]
  };
}

export function renumberFindings(findings: readonly Finding[]): Finding[] {
  return findings.map((finding, index) => ({
    ...cloneFinding(finding),
    findingId: `F${index + 1}`
  }));
}

function cloneFinding(finding: Finding): Finding {
  const cloned: Finding = {
    ...finding,
    traceability: { ...finding.traceability }
  };

  if (finding.dependencyPathException) {
    cloned.dependencyPathException = {
      reason: finding.dependencyPathException.reason,
      dependencyAnchor: { ...finding.dependencyPathException.dependencyAnchor }
    };
  }

  return cloned;
}
