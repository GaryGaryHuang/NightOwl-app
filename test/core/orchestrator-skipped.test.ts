import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("ReviewOrchestrator skips a file after Step 1 exhaustion, publishes a bootstrap warning snapshot, records skipped.md, and continues later files", async () => {
  await assertSkipScenario({
    title: "step1 skip",
    failingStepId: "step1-overview",
    failingStepCause: "judge rejected",
    expectedFailedSnapshotPatterns: [
      /- Status: Review not yet generated\./u,
      /> \[!WARNING\] Review Interrupted/u,
      /step1-overview/u,
      /judge rejected/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Overview/mu]
  });
});

test("ReviewOrchestrator skips a file after Step 2 or Step 4 exhaustion and preserves the correct last successful snapshot", async () => {
  await assertSkipScenario({
    title: "step2 skip",
    failingStepId: "step2-dependencies-boundaries",
    failingStepCause: "judge timeout",
    expectedFailedSnapshotPatterns: [
      /^## Overview/mu,
      /> \[!WARNING\] Review Interrupted/u,
      /step2-dependencies-boundaries/u,
      /judge timeout/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Dependencies & Boundaries/mu]
  });

  await assertSkipScenario({
    title: "step4 skip",
    failingStepId: "step4-strategy-what-if-scenarios",
    failingStepCause: "judge rejected",
    expectedFailedSnapshotPatterns: [
      /^## Knowledge & Source of Truth/mu,
      /> \[!WARNING\] Review Interrupted/u,
      /step4-strategy-what-if-scenarios/u,
      /judge rejected/u
    ],
    expectedFailedSnapshotAbsentPatterns: [
      /^## Strategy & What-if Scenarios/mu,
      /^## Findings/mu
    ]
  });
});

test("ReviewOrchestrator skips a file after Step 5 or Step 6 exhaustion and preserves the correct last successful snapshot", async () => {
  await assertSkipScenario({
    title: "step5 skip",
    failingStepId: "step5-validation-interrogation",
    failingStepCause: "deterministic validation failed",
    expectedFailedSnapshotPatterns: [
      /^## Strategy & What-if Scenarios/mu,
      /> \[!WARNING\] Review Interrupted/u,
      /step5-validation-interrogation/u,
      /deterministic validation failed/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Findings/mu]
  });

  await assertSkipScenario({
    title: "step6 skip",
    failingStepId: "step6-cognitive-simulation",
    failingStepCause: "deterministic validation failed",
    expectedFailedSnapshotPatterns: [
      /^## Findings/mu,
      /\[must\] 初版 findings/u,
      /> \[!WARNING\] Review Interrupted/u,
      /step6-cognitive-simulation/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Summary/mu]
  });
});

test("ReviewOrchestrator skips a file after Step 7 exhaustion, preserves the Step 6 snapshot plus warning block, and continues later files", async () => {
  await assertSkipScenario({
    title: "step7 skip",
    failingStepId: "step7-summary",
    failingStepCause: "judge rejected",
    expectedFailedSnapshotPatterns: [
      /^## Findings/mu,
      /\[must\] 最終 findings/u,
      /> \[!WARNING\] Review Interrupted/u,
      /step7-summary/u,
      /judge rejected/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Summary/mu]
  });
});

test("ReviewOrchestrator can complete a run with both successful and skipped files without introducing aggregate output artifacts", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for mixed-result run");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const outputBaseDir = path.join(fixture.repoDir, "packages", "app");
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createSkipAwareRunner({
        failedFile,
        failingStepId: "step6-cognitive-simulation",
        failingStepCause: "deterministic validation failed"
      }),
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const firstSuccessful = readFileSync(plannedNotes[0].noteFilePath, "utf8");
    const failedSkipped = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    const laterSuccessful = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === laterFile)!.noteFilePath,
      "utf8"
    );
    const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.match(firstSuccessful, /^## Summary/mu);
    assert.match(laterSuccessful, /^## Summary/mu);
    assert.match(failedSkipped, /> \[!WARNING\] Review Interrupted/u);
    assert.match(skippedLog, new RegExp(`- \`${escapeRegExp(failedFile)}\``, "u"));
    assert.doesNotMatch(skippedLog, /aggregate|summary\.md|index\.md/u);
  } finally {
    fixture.cleanup();
  }
});

async function assertSkipScenario(input: {
  title: string;
  failingStepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step4-strategy-what-if-scenarios"
    | "step5-validation-interrogation"
    | "step6-cognitive-simulation"
    | "step7-summary";
  failingStepCause:
    | "judge rejected"
    | "judge timeout"
    | "deterministic validation failed";
  expectedFailedSnapshotPatterns: RegExp[];
  expectedFailedSnapshotAbsentPatterns: RegExp[];
}): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll(`add third changed file for ${input.title}`);

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createSkipAwareRunner({
        failedFile,
        failingStepId: input.failingStepId,
        failingStepCause: input.failingStepCause
      }),
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const failedNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    const laterNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === laterFile)!.noteFilePath,
      "utf8"
    );
    const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

    for (const pattern of input.expectedFailedSnapshotPatterns) {
      assert.match(failedNote, pattern);
    }

    for (const pattern of input.expectedFailedSnapshotAbsentPatterns) {
      assert.doesNotMatch(failedNote, pattern);
    }

    assert.match(
      skippedLog,
      new RegExp(
        `- \`${escapeRegExp(failedFile)}\` — ${escapeRegExp(input.failingStepId)} — ${escapeRegExp(input.failingStepCause)}`,
        "u"
      )
    );
    assert.match(laterNote, /^## Summary/mu);
    assert.doesNotMatch(failedNote, /provisional step|attempt 1|attempt 2/u);
  } finally {
    fixture.cleanup();
  }
}

function createSkipAwareRunner(input: {
  failedFile: string;
  failingStepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step4-strategy-what-if-scenarios"
    | "step5-validation-interrogation"
    | "step6-cognitive-simulation"
    | "step7-summary";
  failingStepCause:
    | "judge rejected"
    | "judge timeout"
    | "deterministic validation failed";
}): StepRunner {
  const reviewAttempts = new Map<string, number>();

  return new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        const stepId = detectStepId(profile.systemMessage);

        return new SessionExecutor({
          async sendAndWait(options) {
            const filePath = extractPromptFilePath(options.prompt);
            const key = `${stepId}:${filePath}`;
            const attempt = (reviewAttempts.get(key) ?? 0) + 1;
            reviewAttempts.set(key, attempt);

            if (filePath === input.failedFile && stepId === input.failingStepId) {
              if (input.failingStepCause === "deterministic validation failed") {
                return { data: { content: "{\"findings\":[}" } };
              }

              return {
                data: {
                  content: buildStepResponse(stepId, filePath)
                }
              };
            }

            return {
              data: {
                content: buildStepResponse(stepId, filePath)
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    structuredOutputValidator: new StructuredOutputValidator(),
    judgeService: {
      async evaluate(inputJudge) {
        if (
          inputJudge.filePath === input.failedFile &&
          inputJudge.stepId === input.failingStepId &&
          (input.failingStepCause === "judge rejected" ||
            input.failingStepCause === "judge timeout")
        ) {
          return { passed: false, cause: input.failingStepCause };
        }

        return { passed: true };
      }
    }
  });
}

function buildOverviewResponse(filePath: string): string {
  return [
    "## Overview",
    `- 整體理解：${filePath} 位於本次 changeset 中`,
    "- 行為變更：無行為變更",
    `- 檔案職責：負責 ${filePath}`,
    "- 改動目的：調整測試資料",
    `- 影響範圍：${filePath}`,
    "- 測試覆蓋觀察：未見對應測試異動"
  ].join("\n");
}

function buildDependenciesResponse(filePath: string): string {
  return [
    "## Dependencies & Boundaries",
    "- 相依清單：",
    `  - \`[${filePath}:valueService]\` → 提供 value 更新 → Consume`,
    "    - Contract：輸入 value 並回傳更新結果",
    "    - 評估：此 diff 維持既有 boundary",
    "- 隱含相依：",
    "  - 無"
  ].join("\n");
}

function buildKnowledgeResponse(filePath: string): string {
  return [
    "## Knowledge & Source of Truth",
    "- 版本／文件參考：",
    `  - ${filePath} package.json — repo-native source`,
    "- 採用規則與假設：",
    "  - 依 repo 內設定檔與版本檔推論行為約束",
    "- 排除範圍：",
    "  - 外部官方文件查證不在本次 foundation 範圍內"
  ].join("\n");
}

function buildStrategyResponse(filePath: string): string {
  return [
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    `  - state transition：${filePath} 這次改動調整了主要執行路徑，值得驗證狀態切換是否一致`,
    "- What-if 假設情境：",
    `  - W1: 觸發條件：${filePath} 輸入為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 直接調整處理流程`,
    `  - W2: 觸發條件：${filePath} 依賴回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示 dependency boundary`,
    `  - W3: 觸發條件：${filePath} 重複執行；預期正確行為：結果應保持穩定；待驗證風險/不確定性：狀態是否累積偏移；與本次改動的關聯：Step 3 已收斂假設與範圍`
  ].join("\n");
}

function buildStep5JsonResponse(): string {
  return JSON.stringify({
    findings: [
      {
        type: "must",
        title: "初版 findings",
        traceability: lineRangeTraceability(14, 18),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 88
      }
    ]
  });
}

function buildStep6JsonResponse(): string {
  return JSON.stringify({
    findings: [
      {
        type: "must",
        title: "最終 findings",
        traceability: lineRangeTraceability(20, 22),
        context: "模擬後確認的具體情境",
        deviation: "經 simulation 後確認最終落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 91
      }
    ]
  });
}

function buildSummaryResponse(filePath: string): string {
  return [
    "## Summary",
    "### 審查基礎",
    `- 改動概要：${filePath} 這次改動主要調整執行流程。`,
    `- 依據規範：依 ${filePath} 的 repo source-of-truth 與版本假設審查。`,
    "- 審查假設：未擴張到外部知識查證。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    "- 整體風險等級：Medium",
    "- 風險理由：final findings 仍需留意。"
  ].join("\n");
}

function lineRangeTraceability(lineStart: number, lineEnd: number) {
  return {
    kind: "line-range",
    lineStart,
    lineEnd
  };
}


function buildStepResponse(
  stepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step3-knowledge-source-of-truth"
    | "step4-strategy-what-if-scenarios"
    | "step5-validation-interrogation"
    | "step6-cognitive-simulation"
    | "step7-summary",
  filePath: string
): string {
  if (stepId === "step1-overview") {
    return buildOverviewResponse(filePath);
  }

  if (stepId === "step2-dependencies-boundaries") {
    return buildDependenciesResponse(filePath);
  }

  if (stepId === "step3-knowledge-source-of-truth") {
    return buildKnowledgeResponse(filePath);
  }

  if (stepId === "step4-strategy-what-if-scenarios") {
    return buildStrategyResponse(filePath);
  }

  if (stepId === "step5-validation-interrogation") {
    return buildStep5JsonResponse();
  }

  if (stepId === "step6-cognitive-simulation") {
    return buildStep6JsonResponse();
  }

  return buildSummaryResponse(filePath);
}

function detectStepId(systemMessage: string):
  | "step1-overview"
  | "step2-dependencies-boundaries"
  | "step3-knowledge-source-of-truth"
  | "step4-strategy-what-if-scenarios"
  | "step5-validation-interrogation"
  | "step6-cognitive-simulation"
  | "step7-summary" {
  if (/## Current Step: Overview/u.test(systemMessage)) {
    return "step1-overview";
  }

  if (/## Current Step: Dependencies & Boundaries/u.test(systemMessage)) {
    return "step2-dependencies-boundaries";
  }

  if (/## Current Step: Knowledge & Source of Truth/u.test(systemMessage)) {
    return "step3-knowledge-source-of-truth";
  }

  if (/## Current Step: Strategy & What-if Scenarios/u.test(systemMessage)) {
    return "step4-strategy-what-if-scenarios";
  }

  if (/## Current Step: Validation & Interrogation/u.test(systemMessage)) {
    return "step5-validation-interrogation";
  }

  if (/## Current Step: Cognitive Simulation/u.test(systemMessage)) {
    return "step6-cognitive-simulation";
  }

  return "step7-summary";
}

function extractPromptFilePath(prompt: string): string {
  const diffMatch = prompt.match(/<diff path="([^"]+)"/u);

  if (diffMatch) {
    return diffMatch[1];
  }

  const sourceMatch = prompt.match(/- Source file: `([^`]+)`/u);

  if (sourceMatch) {
    return sourceMatch[1];
  }

  throw new Error(`Unable to determine file path from prompt: ${prompt}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
