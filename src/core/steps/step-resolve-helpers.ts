import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewSectionKey } from "../review-section-contract.ts";
import type { RiskLevel } from "../risk-level.ts";
import type { StepExecutionPlan } from "../step-runner.ts";
import type {
  VerifierReportArtifactEntry,
  VerifierReportEntry
} from "../verifier-report.ts";

/**
 * Factory for the resolve() closure shared by all section steps (Step 1–4, 7).
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

/**
 * Factory for the resolve() closure shared by all structured steps (Step 5, 6).
 *
 * Runs deterministic validation + acceptance filtering, then returns a
 * deferred mutation that writes the validated findings to the context.
 */
export function createStructuredResolve(input: {
  stepId?: string;
  filePath: string;
  diffContent?: string;
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    const validated = services.validator.validateWithReport({
      responseText: response,
      filePath: input.filePath,
      ...(input.diffContent === undefined
        ? {}
        : { diffContent: input.diffContent })
    });
    const accepted = services.validator.filterByAcceptanceWithReport(validated.payload);
    const reportEntries = toVerifierArtifactEntries({
      filePath: input.filePath,
      stepId: input.stepId ?? "step5-validation-interrogation",
      report: [...validated.report, ...accepted.report]
    });

    return (targetContext: FileReviewContext) => {
      targetContext.setFindings(accepted.payload.findings);
      targetContext.appendVerifierReportEntries(reportEntries);
    };
  };
}

/**
 * Factory for the resolve() closure used by Step 6 when disposition semantics are active.
 *
 * Validates findings + dispositions, checks disposition completeness against
 * candidate finding IDs, filters by acceptance, then defers writing both
 * findings and dispositions to the context.
 */
export function createStep6DispositionResolve(input: {
  stepId?: string;
  filePath: string;
  diffContent?: string;
  candidateFindingIds: readonly string[];
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    const verified = services.validator.validateWithDispositions({
      responseText: response,
      filePath: input.filePath,
      ...(input.diffContent === undefined
        ? {}
        : { diffContent: input.diffContent })
    });

    const accepted = services.validator.filterByAcceptanceWithReport({
      findings: verified.findings
    });
    const acceptedFindingIds = accepted.payload.findings.map((f) => f.findingId);
    const schemaReport = verified.findings.map<VerifierReportEntry>((finding) => ({
      findingId: finding.findingId,
      taxonomy: "OK",
      outcome: "accepted",
      gate: "schema",
      reason: "passed schema and anchor validation"
    }));

    services.validator.validateDispositionCompleteness({
      dispositions: verified.dispositions,
      candidateFindingIds: input.candidateFindingIds,
      acceptedFindingIds
    });

    const reportEntries = toVerifierArtifactEntries({
      filePath: input.filePath,
      stepId: input.stepId ?? "step6-cognitive-simulation",
      report: [...schemaReport, ...accepted.report]
    });

    return (targetContext: FileReviewContext) => {
      targetContext.setFindings(accepted.payload.findings);
      targetContext.setDispositions(verified.dispositions);
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
    reason: entry.reason
  }));
}

const VALID_RISK_LEVELS: ReadonlySet<string> = new Set(["High", "Medium", "Low", "None"]);
const RISK_LEVEL_PATTERN = /整體風險等級[：:]\s*([\w]+)/;

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
}): StepExecutionPlan["resolve"] {
  return async (response, services) => {
    // Deterministic pre-check: risk level must match snapshot
    const parsed = parseRiskLevelFromResponse(response);
    if (parsed !== input.expectedRiskLevel) {
      throw new Error(
        `整體風險等級 risk mismatch: expected "${input.expectedRiskLevel}" but got "${parsed ?? "(unparseable)"}"`
      );
    }

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
