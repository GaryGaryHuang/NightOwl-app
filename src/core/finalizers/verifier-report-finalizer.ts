import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";

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
          ...(entry.dispositionStatus === undefined
            ? {}
            : { dispositionStatus: entry.dispositionStatus }),
          ...(entry.dispositionReason === undefined
            ? {}
            : { dispositionReason: entry.dispositionReason }),
          ...(entry.dispositionExplanation === undefined
            ? {}
            : { dispositionExplanation: entry.dispositionExplanation })
        })
      )
      .join("\n");
}

export type VerifierReportRenderer = typeof renderVerifierReport;
