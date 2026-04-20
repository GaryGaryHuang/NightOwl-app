/**
 * VerifierReport — taxonomy-labeled verification outcome for each finding
 * passing through the StructuredOutputValidator pipeline.
 *
 * Pure data types + builder. No I/O, no mutation of inputs.
 */

export const TAXONOMY_CODES = [
  "PARSE",
  "SCHEMA",
  "ANCHOR",
  "EVIDENCE",
  "REACHABILITY",
  "OUT_OF_SCOPE",
  "DUPLICATE",
  "CONTRADICTION",
  "STALE_CONTEXT",
  "CONFIDENCE_MISUSE",
  "GENERIC_HYPOTHESIS",
  "UNVERIFIABLE_INDIRECT",
  "ACCEPTANCE",
  "OK"
] as const;

export type VerifierTaxonomyCode = (typeof TAXONOMY_CODES)[number];

export interface VerifierReportEntry {
  readonly findingId: string;
  readonly taxonomy: VerifierTaxonomyCode;
  readonly outcome: "accepted" | "rejected";
  readonly gate: "schema" | "anchor" | "acceptance" | "disposition";
  readonly reason: string;
  readonly dispositionStatus?: "retained" | "modified" | "retired";
  readonly dispositionReason?: string;
  readonly dispositionExplanation?: string;
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
