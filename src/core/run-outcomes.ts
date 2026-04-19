import type { Finding } from "./file-review-context.ts";
import type { VerifierReportArtifactEntry } from "./verifier-report.ts";

export interface SuccessfulFileOutcome {
  filePath: string;
  findings: Finding[];
  verifierReportEntries: VerifierReportArtifactEntry[];
}

export interface SkippedFileOutcome {
  filePath: string;
  stepId: string;
  reason: string;
  verifierReportEntries: VerifierReportArtifactEntry[];
}
