import type { Finding } from "./file-review-context.ts";

export interface SuccessfulFileOutcome {
  filePath: string;
  findings: Finding[];
}

export interface SkippedFileOutcome {
  filePath: string;
  stepId: string;
  reason: string;
}
