import {
  lineRangeTraceability
} from "./orchestrator-fixture.ts";

/**
 * Produces a minimal but structurally valid session response for each SOP
 * step by matching against the system-message content.
 *
 * Candidate Findings and Semantic Validation return compact JSON; Review Summary returns Markdown in the
 * format expected by the finalizer.
 */
export function buildSessionResponse(
  config: { systemMessage?: unknown; availableTools?: string[] },
  prompt: string
): string {
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
          confidence: "low"
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

  if (/## Current Step: Candidate Findings/u.test(systemMessage)) {
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
      findingOrigins: [
        {
          findingIndex: 1,
          kind: "hypothesis",
          hypothesisIds: ["H1"],
          evidenceIds: ["E1"],
          rationale: "candidate F1 covers H1"
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

  if (/## Current Step: Semantic Validation/u.test(systemMessage)) {
    return JSON.stringify({
      perFindingResults: [
        {
          findingId: "F1",
          decision: "approve",
          failedGates: [],
          requiredCorrections: [],
          reason: "all semantic gates passed"
        }
      ],
      missingInformationItems: [],
      loopControl: { action: "accept", reason: "all gates passed" }
    });
  }

  if (/## Current Step: Review Summary/u.test(systemMessage)) {
    return [
      "### 審查依據",
      "- 異動概要：這次改動主要調整執行流程。",
      "- 已核對依據：依 repo source-of-truth 與版本假設審查。",
      "- 待確認資訊：無。",
      "### 行為變更提醒",
      "- 無行為變更"
    ].join("\n");
  }

  throw new Error(`Unexpected session prompt: ${prompt}`);
}

function extractSystemMessageContent(systemMessage: unknown): string {
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
