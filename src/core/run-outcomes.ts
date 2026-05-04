import type { Finding } from "./file-review-context.ts";
import type { FindingDisposition } from "./file-review-context.ts";
import type { RiskSnapshot } from "./risk-level.ts";
import type {
  LoopAction,
  StopReason,
  ValidationOverallStatus
} from "./semantic-review.ts";
import type { VerifierReportArtifactEntry } from "./verifier-report.ts";

export type SemanticReviewStatus =
  | "not_run"
  | "passed"
  | "passed_with_limitations"
  | "stopped"
  | "rerun_requested";

export interface SemanticReviewStats {
  status: SemanticReviewStatus;
  overallStatus?: ValidationOverallStatus;
  loopAction?: LoopAction;
  stopReason?: StopReason;
  semanticIterationCount: number;
  candidateFindingCount: number;
  approvedFindingCount: number;
  missingInformationCount: number;
  missingInformationConversionCount: number;
  failedGateCounts: Record<string, number>;
  decisionCounts: Record<string, number>;
  repeatedUnsupportedClaimStopCount: number;
}

export interface SuccessfulFileOutcome {
  filePath: string;
  findings: Finding[];
  verifierReportEntries: VerifierReportArtifactEntry[];
  semanticReview: SemanticReviewStats;
  riskSnapshot: RiskSnapshot;
  dispositions: FindingDisposition[];
}

export interface SkippedFileOutcome {
  filePath: string;
  stepId: string;
  reason: string;
  verifierReportEntries: VerifierReportArtifactEntry[];
  semanticReview: SemanticReviewStats;
  riskSnapshot: RiskSnapshot;
  dispositions: FindingDisposition[];
}
