/**
 * Structured validation report -- taxonomy-labeled validation outcome for each
 * finding passing through the StructuredOutputValidator pipeline.
 *
 * Pure data types. No I/O.
 */

export type StructuredValidationTaxonomyCode = "SCHEMA" | "SEMANTIC" | "OK";

export interface StructuredValidationReportEntry {
  readonly findingId: string;
  readonly taxonomy: StructuredValidationTaxonomyCode;
  readonly outcome: "accepted" | "rejected";
  readonly gate: "schema" | "acceptance" | "semantic";
  readonly reason: string;
}
