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

export const VALIDATION_TAXONOMY_CODES = [
  "SCHEMA",
  "EVIDENCE",
  "REACHABILITY",
  "OUT_OF_SCOPE",
  "DUPLICATE",
  "CONTRADICTION",
  "SEMANTIC",
  "OK"
] as const;

export type StructuredValidationTaxonomyCode =
  (typeof VALIDATION_TAXONOMY_CODES)[number];

export interface StructuredValidationReportEntry {
  readonly findingId: string;
  readonly taxonomy: StructuredValidationTaxonomyCode;
  readonly outcome: "accepted" | "rejected";
  readonly gate: "schema" | "acceptance" | "semantic";
  readonly reason: string;
  readonly semanticIteration?: number;
  readonly semanticGate?: SemanticGateId;
  readonly validationDecision?: ValidationDecision;
  readonly requiredCorrections?: readonly string[];
}
