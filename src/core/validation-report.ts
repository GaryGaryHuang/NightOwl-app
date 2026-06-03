/**
 * Structured validation report -- taxonomy-labeled validation outcome for each
 * finding passing through the StructuredOutputValidator pipeline.
 *
 * Pure data types. No I/O.
 */

import type {
  SemanticGateId,
  ValidationDecision
} from "./semantic-review.ts";

export type StructuredValidationTaxonomyCode =
  | "SCHEMA"
  | "EVIDENCE"
  | "REACHABILITY"
  | "OUT_OF_SCOPE"
  | "DUPLICATE"
  | "CONTRADICTION"
  | "SEMANTIC"
  | "OK";

export interface StructuredValidationReportEntry {
  readonly findingId: string;
  readonly taxonomy: StructuredValidationTaxonomyCode;
  readonly outcome: "accepted" | "rejected";
  readonly gate: "schema" | "acceptance" | "semantic";
  readonly reason: string;
  readonly semanticGate?: SemanticGateId;
  readonly validationDecision?: ValidationDecision;
  readonly requiredCorrections?: readonly string[];
}
