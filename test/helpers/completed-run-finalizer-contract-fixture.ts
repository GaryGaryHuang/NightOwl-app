import type { Finding } from "../../src/core/file-review-context.ts";
import type {
  OutputTarget,
  PlannedNoteFile
} from "../../src/core/review-path-resolver.ts";
import type { RunCoverageBuckets } from "../../src/core/run-coverage.ts";
import { resolveFileOutcomes, type ResolvedFileOutcome } from "../../src/core/run-outcome-resolver.ts";
import type {
  SemanticReviewStats
} from "../../src/core/run-outcomes.ts";
import type { RiskSnapshot } from "../../src/core/risk-level.ts";
import type { VerifierReportArtifactEntry } from "../../src/core/verifier-report.ts";
import type { SkippedFileOutcome, SuccessfulFileOutcome } from "../../src/core/run-outcomes.ts";

// Stable fake path used as the default base for all output target fixtures;
// does not need to exist on disk since finalizer tests operate on in-memory
// structs rather than reading back written files.
const DEFAULT_BASE_PATH = "/workspace/.nightowl/review/feature-branch_03131430";

export function createFinding(
  type: "must" | "nice",
  idSuffix: number,
  input: { title?: string } = {}
): Finding {
  const classification = type === "must" ? "confirmed_problem" : "reasonable_risk";
  const severity = type === "must" ? "high" : "low";
  return {
    findingId: `${type}-${idSuffix}`,
    classification,
    severity,
    title: input.title ?? `${type} finding`,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    evidence: "concrete code evidence",
    triggerCondition: "trigger condition",
    impact: "impact",
    counterEvidence: ["checked alternative"]
  } as Finding;
}

export function createSuccessfulFile(
  filePath: string,
  findings: Finding[],
  verifierReportEntries: VerifierReportArtifactEntry[] = [],
  semanticReview?: Partial<SemanticReviewStats>
): SuccessfulFileOutcome {
  return {
    filePath,
    findings,
    verifierReportEntries,
    semanticReview: createSemanticReviewStats(semanticReview),
    riskSnapshot: createRiskSnapshot(findings, semanticReview),
    dispositions: []
  };
}

export function createSkippedFile(
  filePath: string,
  stepId: string,
  reason: string,
  verifierReportEntries: VerifierReportArtifactEntry[] = [],
  semanticReview?: Partial<SemanticReviewStats>
): SkippedFileOutcome {
  return {
    filePath,
    stepId,
    reason,
    verifierReportEntries,
    semanticReview: createSemanticReviewStats(semanticReview),
    riskSnapshot: createRiskSnapshot([], semanticReview),
    dispositions: []
  };
}

export function createSemanticReviewStats(
  overrides: Partial<SemanticReviewStats> = {}
): SemanticReviewStats {
  const status = overrides.status ?? "not_run";
  return {
    status,
    ...(overrides.loopAction === undefined
      ? {}
      : { loopAction: overrides.loopAction }),
    semanticIterationCount:
      overrides.semanticIterationCount ?? (status === "not_run" ? 0 : 1),
    candidateFindingCount: overrides.candidateFindingCount ?? 0,
    approvedFindingCount: overrides.approvedFindingCount ?? 0,
    missingInformationCount: overrides.missingInformationCount ?? 0,
    failedGateCounts: overrides.failedGateCounts ?? {},
    decisionCounts: overrides.decisionCounts ?? {}
  };
}

function createRiskSnapshot(
  findings: readonly Finding[],
  semanticReview?: Partial<SemanticReviewStats>
): RiskSnapshot {
  const mustCount = findings.filter((f) => f.classification === "confirmed_problem" && f.severity === "high").length;
  const niceCount = findings.filter((f) => !(f.classification === "confirmed_problem" && f.severity === "high")).length;
  return {
    schemaVersion: 1,
    derivedRiskLevel: mustCount > 0 ? "High" : niceCount > 0 ? "Low" : "None",
    mustCount,
    niceCount,
    acceptedFindingIds: findings.map((finding) => finding.findingId),
    retiredFindingCount: 0,
    riskBasis:
      semanticReview?.missingInformationCount
        ? "No approved findings; semantic validation completed with limitations."
        : "Derived from approved findings."
  };
}

export function createCoverageBuckets(
  overrides: Partial<RunCoverageBuckets> = {}
): RunCoverageBuckets {
  return {
    totalChangedPaths: overrides.totalChangedPaths ?? 4,
    reviewableNonDeletedPaths: overrides.reviewableNonDeletedPaths ?? 3,
    plannedReviewableNotePaths: overrides.plannedReviewableNotePaths ?? 2,
    deletedPaths: overrides.deletedPaths ?? 1,
    binaryOrNonReviewablePaths: overrides.binaryOrNonReviewablePaths ?? 1,
    successfulPlannedFiles: overrides.successfulPlannedFiles ?? 1,
    skippedPlannedFiles: overrides.skippedPlannedFiles ?? 1,
    changedTests: overrides.changedTests ?? ["test/app.test.ts"]
  };
}

export function createVerifierReportArtifactEntry(
  overrides: Partial<VerifierReportArtifactEntry> = {}
): VerifierReportArtifactEntry {
  return {
    filePath: overrides.filePath ?? "src/app.ts",
    stepId: overrides.stepId ?? "step5-validation-interrogation",
    findingId: overrides.findingId ?? "F1",
    taxonomy: overrides.taxonomy ?? "OK",
    outcome: overrides.outcome ?? "accepted",
    gate: overrides.gate ?? "acceptance",
    reason: overrides.reason ?? "passed all acceptance gates",
    ...(overrides.dispositionStatus === undefined
      ? {}
      : { dispositionStatus: overrides.dispositionStatus }),
    ...(overrides.dispositionReason === undefined
      ? {}
      : { dispositionReason: overrides.dispositionReason }),
    ...(overrides.dispositionExplanation === undefined
      ? {}
      : { dispositionExplanation: overrides.dispositionExplanation }),
    ...overrides
  } as VerifierReportArtifactEntry;
}

// Builds a complete OutputTarget from the given basePath (or DEFAULT_BASE_PATH
// if omitted), applying per-field overrides where provided. This keeps test
// setup concise: callers only specify the fields their assertion cares about.
export function createOutputTarget(
  overrides: Partial<OutputTarget> = {}
): OutputTarget {
  const basePath = overrides.basePath ?? DEFAULT_BASE_PATH;

  return {
    basePath,
    changesetOverviewPath:
      overrides.changesetOverviewPath ?? `${basePath}/changeset-overview.md`,
    filesPath: overrides.filesPath ?? `${basePath}/files`,
    skippedPath: overrides.skippedPath ?? `${basePath}/skipped.md`,
    summaryPath: overrides.summaryPath ?? `${basePath}/summary.md`,
    indexPath: overrides.indexPath ?? `${basePath}/index.md`,
    verifierReportPath:
      overrides.verifierReportPath ?? `${basePath}/verifier-report.jsonl`,
    manifestPath: overrides.manifestPath ?? `${basePath}/manifest.json`,
    toolAuditPath: overrides.toolAuditPath ?? `${basePath}/tool-audit.jsonl`
  };
}

export function createPlannedNote(
  filePath: string,
  noteFilePath: string
): PlannedNoteFile {
  return { filePath, noteFilePath };
}

export function createPlannedNotes(
  entries: Array<[filePath: string, noteFilePath: string]>
): PlannedNoteFile[] {
  return entries.map(([filePath, noteFilePath]) =>
    createPlannedNote(filePath, noteFilePath)
  );
}

export function createPlannedNotesFromPaths(
  filePaths: string[]
): PlannedNoteFile[] {
  return filePaths.map((filePath) =>
    createPlannedNote(
      filePath,
      `${DEFAULT_BASE_PATH}/files/${filePath.replace(/\//gu, "__")}.md`
    )
  );
}

export function createResolvedOutcomes(
  plannedNotes: PlannedNoteFile[],
  successfulFiles: SuccessfulFileOutcome[],
  skippedFiles: SkippedFileOutcome[]
): ResolvedFileOutcome[] {
  return resolveFileOutcomes(plannedNotes, successfulFiles, skippedFiles);
}
