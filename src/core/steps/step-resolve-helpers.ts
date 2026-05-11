import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewBasisV1 } from "../review-basis.ts";
import type { ReviewSectionKey } from "../review-section-contract.ts";
import type { RiskLevel } from "../risk-level.ts";
import {
  CANDIDATE_FINDINGS_STEP_ID,
  SEMANTIC_VALIDATION_STEP_ID
} from "../review-step-ids.ts";
import type {
  CandidateFindingsV3,
  ValidationReportV1
} from "../semantic-review.ts";
import type { StepExecutionPlan } from "../step-runner.ts";
import type {
  VerifierReportArtifactEntry,
  VerifierReportEntry
} from "../verifier-report.ts";
import { pickSemanticFields } from "../verifier-report.ts";

export function createCandidateFindingsV3Resolve(input: {
  stepId?: string;
  filePath: string;
  diffContent?: string;
  reviewBasis: ReviewBasisV1;
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    const validated = services.validator.validateCandidateFindingsV3WithReport({
      responseText: response,
      reviewBasis: input.reviewBasis,
      filePath: input.filePath,
      ...(input.diffContent === undefined
        ? {}
        : { diffContent: input.diffContent })
    });
    const reportEntries = toVerifierArtifactEntries({
      filePath: input.filePath,
      stepId: input.stepId ?? CANDIDATE_FINDINGS_STEP_ID,
      report: validated.report
    });

    return (targetContext: FileReviewContext) => {
      targetContext.setCandidateFindingsV3(validated.payload);
      targetContext.appendVerifierReportEntries(reportEntries);
    };
  };
}

export function createValidationReportV1Resolve(input: {
  stepId?: string;
  filePath: string;
  diffContent?: string;
  reviewBasis?: ReviewBasisV1;
  candidatePayload: CandidateFindingsV3 | Record<string, unknown>;
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    const validated = services.validator.validateValidationReportV1WithReport({
      responseText: response,
      candidateFindings: input.candidatePayload,
      ...(input.reviewBasis === undefined ? {} : { reviewBasis: input.reviewBasis }),
      filePath: input.filePath,
      ...(input.diffContent === undefined
        ? {}
        : { diffContent: input.diffContent })
    });
    const reportEntries = toVerifierArtifactEntries({
      filePath: input.filePath,
      stepId: input.stepId ?? SEMANTIC_VALIDATION_STEP_ID,
      report: validated.report
    });

    return (targetContext: FileReviewContext) => {
      targetContext.setValidationReportV1(validated.payload);
      targetContext.setMissingInformationItems(validated.payload.missingInformationItems);
      const approvedIds = new Set(
        validated.payload.perFindingResults
          .filter((r) => r.decision === "approve")
          .map((r) => r.findingId)
      );
      const candidates = "findings" in input.candidatePayload
        ? (input.candidatePayload as CandidateFindingsV3).findings
        : [];
      targetContext.setFindings(
        candidates.filter((f) => approvedIds.has(f.findingId))
      );
      targetContext.appendVerifierReportEntries(reportEntries);
    };
  };
}

function toVerifierArtifactEntries(input: {
  filePath: string;
  stepId: string;
  report: VerifierReportEntry[];
}): VerifierReportArtifactEntry[] {
  return input.report.map((entry) => ({
    filePath: input.filePath,
    stepId: input.stepId,
    findingId: entry.findingId,
    taxonomy: entry.taxonomy,
    outcome: entry.outcome,
    gate: entry.gate,
    reason: entry.reason,
    ...pickSemanticFields(entry)
  }));
}

const VALID_RISK_LEVELS: ReadonlySet<string> = new Set(["High", "Low", "None"]);
const RISK_LEVEL_PATTERN = /(?:整體風險等級|Overall risk level)[：:]\s*([\w]+)/i;

/**
 * Parse the `整體風險等級` value from a Review Summary summary response.
 * Returns `undefined` when the line is missing or the value is not a canonical risk level.
 */
export function parseRiskLevelFromResponse(response: string): RiskLevel | undefined {
  const match = RISK_LEVEL_PATTERN.exec(response);
  if (!match) return undefined;
  const candidate = match[1].trim();
  return VALID_RISK_LEVELS.has(candidate) ? (candidate as RiskLevel) : undefined;
}

/**
 * Factory for the resolve() closure used by Review Summary.
 *
 * Review Summary is user-facing packaging, not a semantic review step. Keep validation
 * lightweight and deterministic: reject only broken packaging and host-owned
 * fields before writing the composed Summary.
 */
export function createReviewSummaryResolve(input: {
  stepId: string;
  filePath: string;
  sectionKey: ReviewSectionKey;
  expectedRiskLevel: RiskLevel;
  forbiddenResponsePatterns?: readonly RegExp[];
  composeReport?: (response: string) => string;
}): StepExecutionPlan["resolve"] {
  return async (response) => {
    rejectMalformedReviewSummaryNarrative(response);
    rejectForbiddenReviewSummaryResponsePatterns(response, input.forbiddenResponsePatterns ?? []);
    const sectionContent = input.composeReport?.(response) ?? response;

    // Deterministic pre-check: risk level must match snapshot
    const parsed = parseRiskLevelFromResponse(sectionContent);
    if (parsed !== input.expectedRiskLevel) {
      throw new Error(
        `整體風險等級 risk mismatch: expected "${input.expectedRiskLevel}" but got "${parsed ?? "(unparseable)"}"`
      );
    }

    return (targetContext: FileReviewContext) => {
      targetContext.setSection(input.sectionKey, sectionContent);
    };
  };
}

const REVIEW_SUMMARY_NARRATIVE_SECTION_PATTERNS: readonly {
  label: string;
  pattern: RegExp;
}[] = [
  { label: "審查依據", pattern: /^#{2,4}\s+審查依據(?:[：:]|\s|$)/mu },
  { label: "行為變更提醒", pattern: /^#{2,4}\s+行為變更提醒(?:[：:]|\s|$)/mu },
  { label: "風險判定理由", pattern: /^#{2,4}\s+風險判定理由(?:[：:]|\s|$)/mu }
];

function rejectMalformedReviewSummaryNarrative(response: string): void {
  if (response.trim().length === 0) {
    throw new Error("Review Summary narrative response is empty");
  }

  for (const section of REVIEW_SUMMARY_NARRATIVE_SECTION_PATTERNS) {
    if (!section.pattern.test(response)) {
      throw new Error(
        `Review Summary narrative is missing required section: ${section.label}`
      );
    }
  }
}

function rejectForbiddenReviewSummaryResponsePatterns(
  response: string,
  patterns: readonly RegExp[]
): void {
  for (const pattern of patterns) {
    const match = pattern.exec(response);
    if (match) {
      throw new Error(
        `Review Summary narrative attempted to own a host-computed report field: ${match[0]}`
      );
    }
  }
}
