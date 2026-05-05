import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";
import { pickSemanticFields } from "../verifier-report.ts";

export interface VerifierReportRenderInput {
  resolvedOutcomes: ResolvedFileOutcome[];
}

export function renderVerifierReport(input: VerifierReportRenderInput): string {
    return input.resolvedOutcomes
      .flatMap((item) => item.outcome.verifierReportEntries)
      .map((entry) =>
        JSON.stringify({
          filePath: entry.filePath,
          stepId: entry.stepId,
          findingId: entry.findingId,
          taxonomy: entry.taxonomy,
          outcome: entry.outcome,
          gate: entry.gate,
          reason: entry.reason,
          ...pickSemanticFields(entry)
        })
      )
      .join("\n");
}

export type VerifierReportRenderer = typeof renderVerifierReport;
