import {
  lineRangeTraceability
} from "./orchestrator-fixture.ts";

/**
 * Produces a minimal but structurally valid session response for each SOP
 * step by matching against the system-message content.
 *
 * Judge sessions (no availableTools) receive a plain "Y" so the completion
 * check passes without needing real AI output.
 * Steps 5–6 return compact JSON findings; Step 7 returns Markdown in the
 * format expected by the finalizer.
 */
export function buildSessionResponse(
  config: { systemMessage?: unknown; availableTools?: string[] },
  prompt: string
): string {
  if (Array.isArray(config.availableTools) && config.availableTools.length === 0) {
    return "Y";
  }

  const systemMessage = extractSystemMessageContent(config.systemMessage);

  if (/## Current Step: ReviewBasis/u.test(systemMessage)) {
    const filePath = extractDiffPath(prompt) ?? "src/app.ts";
    return JSON.stringify({
      filePath,
      roleInChangeset: "Maintains app value behavior.",
      changedBehavior: [
        {
          before: "old value path",
          after: "new value path",
          evidenceIds: ["E1"]
        }
      ],
      facts: [
        {
          statement: "The diff changes the reviewed file.",
          evidenceIds: ["E1"]
        }
      ],
      inferences: [
        {
          statement: "The changed branch may affect fallback behavior.",
          basedOnEvidenceIds: ["E1"],
          confidence: "medium"
        }
      ],
      dependencyMap: {
        upstreamCallers: [],
        downstreamConsumers: [],
        externalContracts: [],
        sharedStateOrSideEffects: []
      },
      flowMap: {
        entryPoints: [],
        stateTransitions: [],
        asyncBoundaries: [],
        errorPaths: []
      },
      testCoverage: {
        changedTests: [],
        observedCoverageSignals: [],
        coverageGaps: []
      },
      identifierRegistry: {
        files: [filePath],
        symbols: [],
        resourceKeys: [],
        apiNames: [],
        stateNames: []
      },
      hypothesisLedger: [
        {
          hypothesisId: "H1",
          statement: "Fallback behavior could be skipped.",
          triggerCondition: "empty input reaches the changed branch",
        }
      ],
      missingInformation: [],
      evidenceRefs: [
        {
          evidenceId: "E1",
          sourceType: "diff",
          location: filePath,
          summary: "Reviewed file diff."
        }
      ]
    });
  }

  if (/## Current Step: Validation & Interrogation/u.test(systemMessage)) {
    return JSON.stringify({
      findings: [
        {
          classification: "confirmed_problem",
          severity: "high",
          title: "問題標題",
          traceability: lineRangeTraceability(1, 1),
          evidence: "新分支略過 fallback at src/app.ts:1",
          triggerCondition: "empty input reaches the changed branch",
          impact: "會造成 correctness 問題",
          counterEvidence: ["fallback path is after the changed branch"]
        }
      ],
      hypothesisClosure: [
        {
          hypothesisId: "H1",
          status: "closed_by_candidate",
          rationale: "candidate F1 covers the hypothesis"
        }
      ],
      criticalMissingInformation: []
    });
  }

  if (/## Current Step: (?:Cognitive Simulation|Semantic Validation)/u.test(systemMessage)) {
    return JSON.stringify({
      schemaVersion: 1,
      overallStatus: "PASS",
      perFindingResults: [
        {
          findingId: "F1",
          decision: "approve",
          failedGates: [],
          requiredCorrections: [],
          reason: "all semantic gates passed"
        }
      ],
      approvedFindings: [
        {
          type: "must",
          title: "問題標題",
          traceability: lineRangeTraceability(1, 1),
          expectedBehavior: "應維持既有 fallback",
          actualBehavior: "simulation reaches branch without fallback",
          deviation: "預期與實際有落差",
          impact: "會造成 correctness 問題",
          suggestion: "補上 guard",
          findingId: "F1"
        }
      ],
      missingInformationItems: [],
      loopControl: { action: "accept", reason: "all gates passed" }
    });
  }

  if (/## Current Step: Summary/u.test(systemMessage)) {
    return [
      "## Summary",
      "### 審查基礎",
      "- 改動概要：這次改動主要調整執行流程。",
      "- 依據規範：依 repo source-of-truth 與版本假設審查。",
      "- 必要假設：無。",
      "### 行為變更提醒",
      "- 無",
      "### 風險評估",
      "- 整體風險等級：High",
      "- 風險理由：至少一個 must-fix finding 經驗證後仍成立。"
    ].join("\n");
  }

  throw new Error(`Unexpected session prompt: ${prompt}`);
}

export function extractSystemMessageContent(systemMessage: unknown): string {
  if (
    systemMessage &&
    typeof systemMessage === "object" &&
    "content" in systemMessage &&
    typeof systemMessage.content === "string"
  ) {
    return systemMessage.content;
  }

  return "";
}

function extractDiffPath(prompt: string): string | undefined {
  const match = prompt.match(/<diff path="([^"]+)"/u);
  return match?.[1];
}

// Each predicate matches the step-identifying header embedded in the session's
// system message; used by tests to locate specific session configs in recorded
// arrays without coupling to session index order.
export function isReviewBasisSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: ReviewBasis/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

export function isChangesetOverviewSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Changeset Overview/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

export function isValidationInterrogationSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Validation & Interrogation/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

export function isJudgeSystemMessage(systemMessage: unknown): boolean {
  return /Output only Y or N/u.test(extractSystemMessageContent(systemMessage));
}
