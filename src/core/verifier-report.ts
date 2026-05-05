/**
 * VerifierReport — taxonomy-labeled verification outcome for each finding
 * passing through the StructuredOutputValidator pipeline.
 *
 * Pure data types + builder. No I/O, no mutation of inputs.
 */

import type {
  SemanticGateId,
  ValidationDecision
} from "./semantic-review.ts";

export const TAXONOMY_CODES = [
  "SCHEMA",
  "EVIDENCE",
  "REACHABILITY",
  "OUT_OF_SCOPE",
  "DUPLICATE",
  "CONTRADICTION",
  "SEMANTIC",
  "OK"
] as const;

export type VerifierTaxonomyCode = (typeof TAXONOMY_CODES)[number];

export interface VerifierReportEntry {
  readonly findingId: string;
  readonly taxonomy: VerifierTaxonomyCode;
  readonly outcome: "accepted" | "rejected";
  readonly gate: "schema" | "acceptance" | "semantic";
  readonly reason: string;
  readonly semanticIteration?: number;
  readonly semanticGate?: SemanticGateId;
  readonly validationDecision?: ValidationDecision;
  readonly requiredCorrections?: readonly string[];
}

export interface VerifierReportArtifactEntry extends VerifierReportEntry {
  readonly filePath: string;
  readonly stepId: string;
}

export interface VerifierReportSummary {
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly byTaxonomy: Readonly<Record<VerifierTaxonomyCode, number>>;
}

function cloneEntry(entry: VerifierReportEntry): VerifierReportEntry {
  return { ...entry };
}

export function pickSemanticFields(
  entry: VerifierReportEntry
): Partial<VerifierReportEntry> {
  return {
    ...(entry.semanticIteration === undefined
      ? {}
      : { semanticIteration: entry.semanticIteration }),
    ...(entry.semanticGate === undefined ? {} : { semanticGate: entry.semanticGate }),
    ...(entry.validationDecision === undefined
      ? {}
      : { validationDecision: entry.validationDecision }),
    ...(entry.requiredCorrections === undefined
      ? {}
      : { requiredCorrections: [...entry.requiredCorrections] })
  };
}

export class VerifierReportBuilder {
  readonly #entries: VerifierReportEntry[] = [];

  addEntry(entry: VerifierReportEntry): void {
    this.#entries.push(cloneEntry(entry));
  }

  getEntries(): readonly VerifierReportEntry[] {
    return this.#entries.map(cloneEntry);
  }

  summarize(): VerifierReportSummary {
    const byTaxonomy = Object.fromEntries(
      TAXONOMY_CODES.map((code) => [code, 0])
    ) as Record<VerifierTaxonomyCode, number>;

    let accepted = 0;
    let rejected = 0;

    for (const entry of this.#entries) {
      byTaxonomy[entry.taxonomy] += 1;
      if (entry.outcome === "accepted") {
        accepted += 1;
      } else {
        rejected += 1;
      }
    }

    return {
      total: this.#entries.length,
      accepted,
      rejected,
      byTaxonomy
    };
  }
}
