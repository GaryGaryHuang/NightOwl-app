import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewBasisV1 } from "../review-basis.ts";
import type { ReviewSectionKey } from "../review-section-contract.ts";
import type { RiskLevel } from "../risk-level.ts";
import type {
  CandidateFindingsV3,
  ValidationReportV1
} from "../semantic-review.ts";
import type { StepExecutionPlan } from "../step-runner.ts";
import type {
  VerifierReportArtifactEntry,
  VerifierReportEntry
} from "../verifier-report.ts";
import { pickDispositionFields, pickSemanticFields } from "../verifier-report.ts";

/**
 * Factory for the resolve() closure shared by section-producing steps.
 *
 * Calls judgeService.evaluate() with the given criteria; on pass, returns a
 * deferred mutation that writes the response to the designated section key.
 */
export function createSectionResolve(input: {
  stepId: string;
  filePath: string;
  sectionKey: ReviewSectionKey;
  criteria: string;
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    if (!services.judgeService) {
      throw new Error("judge service is not configured");
    }

    const judgeResult = await services.judgeService.evaluate({
      stepId: input.stepId,
      filePath: input.filePath,
      criteria: input.criteria,
      sectionContent: response
    });

    if (!judgeResult.passed) {
      throw new Error(judgeResult.cause ?? "judge rejected");
    }

    return (targetContext: FileReviewContext) => {
      targetContext.setSection(input.sectionKey, response);
    };
  };
}

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
      stepId: input.stepId ?? "step5-validation-interrogation",
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
      stepId: input.stepId ?? "step6-cognitive-simulation",
      report: validated.report
    });

    return (targetContext: FileReviewContext) => {
      targetContext.setValidationReportV1(validated.payload);
      targetContext.setMissingInformationItems(validated.payload.missingInformationItems);
      targetContext.setFindings(validated.payload.approvedFindings);
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
    ...pickDispositionFields(entry),
    ...pickSemanticFields(entry)
  }));
}

const VALID_RISK_LEVELS: ReadonlySet<string> = new Set(["High", "Low", "None"]);
const RISK_LEVEL_PATTERN = /(?:整體風險等級|Overall risk level)[：:]\s*([\w]+)/i;

/**
 * Parse the `整體風險等級` value from a Step 7 summary response.
 * Returns `undefined` when the line is missing or the value is not a canonical risk level.
 */
export function parseRiskLevelFromResponse(response: string): RiskLevel | undefined {
  const match = RISK_LEVEL_PATTERN.exec(response);
  if (!match) return undefined;
  const candidate = match[1].trim();
  return VALID_RISK_LEVELS.has(candidate) ? (candidate as RiskLevel) : undefined;
}

/**
 * Factory for the resolve() closure used by Step 7 with hybrid validation.
 *
 * 1. Deterministic pre-check: parse `整體風險等級` from the response and compare
 *    against `expectedRiskLevel`. Mismatch → throw immediately (no judge call).
 * 2. Judge check: delegate to `judgeService.evaluate()` for section structure.
 * 3. On pass → return deferred mutation writing the Summary section.
 */
export function createStep7HybridResolve(input: {
  stepId: string;
  filePath: string;
  sectionKey: ReviewSectionKey;
  criteria: string;
  expectedRiskLevel: RiskLevel;
  allowedFindingIds?: readonly string[];
  allowedMissingInformationIds?: readonly string[];
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    // Deterministic pre-check: risk level must match snapshot
    const parsed = parseRiskLevelFromResponse(response);
    if (parsed !== input.expectedRiskLevel) {
      throw new Error(
        `整體風險等級 risk mismatch: expected "${input.expectedRiskLevel}" but got "${parsed ?? "(unparseable)"}"`
      );
    }

    rejectUnknownStep7Claims(response, input);

    // Judge check: section structure validation
    if (!services.judgeService) {
      throw new Error("judge service is not configured");
    }

    const judgeResult = await services.judgeService.evaluate({
      stepId: input.stepId,
      filePath: input.filePath,
      criteria: input.criteria,
      sectionContent: response
    });

    if (!judgeResult.passed) {
      throw new Error(judgeResult.cause ?? "judge rejected");
    }

    return (targetContext: FileReviewContext) => {
      targetContext.setSection(input.sectionKey, response);
    };
  };
}

function rejectUnknownStep7Claims(
  response: string,
  input: {
    allowedFindingIds?: readonly string[];
    allowedMissingInformationIds?: readonly string[];
  }
): void {
  const allowedFindingIds = new Set(input.allowedFindingIds ?? []);
  if (input.allowedFindingIds) {
    for (const findingId of extractTokenIds(response, /\bF(?:[0-9][0-9A-Za-z_-]*|-[0-9A-Za-z_-]+)\b/gu)) {
      if (!allowedFindingIds.has(findingId)) {
        throw new Error(
          `Step 7 packaging introduced a new claim outside approved findings: ${findingId}`
        );
      }
    }
  }

  const allowedMissingInformationIds = new Set(input.allowedMissingInformationIds ?? []);
  if (input.allowedMissingInformationIds) {
    for (const missingInfoId of extractTokenIds(response, /\bMI(?:[0-9][0-9A-Za-z_-]*|-[0-9A-Za-z_-]+)\b/gu)) {
      if (!allowedMissingInformationIds.has(missingInfoId)) {
        throw new Error(
          `Step 7 packaging introduced a new missing-information claim outside Step 6 state: ${missingInfoId}`
        );
      }
    }
  }
}

function extractTokenIds(response: string, pattern: RegExp): string[] {
  const ids = new Set<string>();
  for (const match of response.matchAll(pattern)) {
    if (match[0]) {
      ids.add(match[0]);
    }
  }
  return [...ids];
}
