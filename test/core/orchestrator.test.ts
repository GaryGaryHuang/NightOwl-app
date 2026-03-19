import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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

test("ReviewOrchestrator does not start Step 3, Step 4, Step 5, or Step 6 for a failed Step 2 file or any later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step2 gating");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const stepEvents = [];
    const reviewAttempts = new Map();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession(profile) {
            const stepId = detectStepId(profile.systemMessage);

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);
                const key = `${stepId}:${filePath}`;
                const attempt = (reviewAttempts.get(key) ?? 0) + 1;

                reviewAttempts.set(key, attempt);
                stepEvents.push([stepId, filePath]);

                if (
                  stepId === "step2-dependencies-boundaries" &&
                  filePath === failedFile
                ) {
                  return { data: { content: "   " } };
                }

                return { data: { content: buildStepResponse(stepId, filePath) } };
              },
              async disconnect() {}
            });
          }
        },
        structuredOutputValidator: new StructuredOutputValidator(),
        judgeService: {
          async evaluate() {
            return { passed: true };
          }
        }
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      new RegExp(
        `step2-dependencies-boundaries.*${escapeRegExp(failedFile)}|${escapeRegExp(failedFile)}.*step2-dependencies-boundaries`,
        "u"
      )
    );

    assert.equal(
      reviewAttempts.get(`step3-knowledge-source-of-truth:${failedFile}`),
      undefined
    );
    assert.equal(
      reviewAttempts.get(`step4-strategy-what-if-scenarios:${failedFile}`),
      undefined
    );
    assert.equal(
      reviewAttempts.get(`step5-validation-interrogation:${failedFile}`),
      undefined
    );
    assert.equal(
      reviewAttempts.get(`step6-cognitive-simulation:${failedFile}`),
      undefined
    );
    assert.deepEqual(stepEvents, [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step5-validation-interrogation", reviewableFiles[0]],
      ["step6-cognitive-simulation", reviewableFiles[0]],
      ["step1-overview", failedFile],
      ["step2-dependencies-boundaries", failedFile],
      ["step2-dependencies-boundaries", failedFile]
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 2 or later steps for a failed Step 1 file or any later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step1 gating");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const stepEvents = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession(profile) {
            const stepId = detectStepId(profile.systemMessage);

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);
                stepEvents.push([stepId, filePath]);

                if (stepId === "step1-overview" && filePath === failedFile) {
                  return { data: { content: "   " } };
                }

                return { data: { content: buildStepResponse(stepId, filePath) } };
              },
              async disconnect() {}
            });
          }
        },
        structuredOutputValidator: new StructuredOutputValidator(),
        judgeService: {
          async evaluate() {
            return { passed: true };
          }
        }
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      new RegExp(
        `step1-overview.*${escapeRegExp(failedFile)}|${escapeRegExp(failedFile)}.*step1-overview`,
        "u"
      )
    );

    assert.deepEqual(stepEvents, [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step5-validation-interrogation", reviewableFiles[0]],
      ["step6-cognitive-simulation", reviewableFiles[0]],
      ["step1-overview", failedFile],
      ["step1-overview", failedFile]
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator preserves a full successful Step 6 snapshot when a later file fails at Step 1", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step1 snapshot preservation");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const outputBaseDir = path.join(fixture.repoDir, "packages", "app");
    const plannedNotes = planNoteFiles(
      path.join(outputBaseDir, "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const successfulFile = reviewableFiles[0];
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession(profile) {
            const stepId = detectStepId(profile.systemMessage);

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);

                if (stepId === "step1-overview" && filePath === failedFile) {
                  return { data: { content: "   " } };
                }

                return { data: { content: buildStepResponse(stepId, filePath) } };
              },
              async disconnect() {}
            });
          }
        },
        structuredOutputValidator: new StructuredOutputValidator(),
        judgeService: {
          async evaluate() {
            return { passed: true };
          }
        }
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      new RegExp(
        `step1-overview.*${escapeRegExp(failedFile)}|${escapeRegExp(failedFile)}.*step1-overview`,
        "u"
      )
    );

    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === successfulFile
    );
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile);
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile);

    const successfulNoteContent = readFileSync(successfulNote.noteFilePath, "utf8");
    assert.match(successfulNoteContent, /^## Findings/mu);
    assert.doesNotMatch(successfulNoteContent, /Review not yet generated/u);

    const failedNoteContent = readFileSync(failedNote.noteFilePath, "utf8");
    assert.match(failedNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(failedNoteContent, /^## Overview/mu);

    const laterNoteContent = readFileSync(laterNote.noteFilePath, "utf8");
    assert.match(laterNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(laterNoteContent, /^## Findings/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator preserves an already-published full Step 6 snapshot when getDiff fails after output initialization", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for getDiff failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const outputBaseDir = path.join(fixture.repoDir, "packages", "app");
    const outputTarget = path.join(
      outputBaseDir,
      "review",
      "feature-branch_03131430"
    );
    const plannedNotes = planNoteFiles(path.join(outputTarget, "files"), reviewableFiles);
    const failedFile = reviewableFiles[1];
    const executedSteps = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: {
        resolveRepoRoot(startPath) {
          return sourceProvider.resolveRepoRoot(startPath);
        },
        getChangedFiles(repoRootArg, baseRef, headRef) {
          return sourceProvider.getChangedFiles(repoRootArg, baseRef, headRef);
        },
        getChangesetEntries(repoRootArg, baseRef, headRef) {
          return sourceProvider.getChangesetEntries(repoRootArg, baseRef, headRef);
        },
        getDiff(repoRootArg, baseRef, headRef, filePath) {
          if (filePath === failedFile) {
            throw new Error("git diff failed");
          }

          return sourceProvider.getDiff(repoRootArg, baseRef, headRef, filePath);
        },
        getCurrentBranch(repoRootArg) {
          return sourceProvider.getCurrentBranch(repoRootArg);
        },
        filterIgnoredFiles(repoRootArg, files) {
          return sourceProvider.filterIgnoredFiles(repoRootArg, files);
        }
      },
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: {
        async run({ context, step }) {
          executedSteps.push([step.stepId, context.filePath]);

          if (step.stepId === "step1-overview") {
            context.setSection("overview", buildOverviewResponse(context.filePath));

            return {
              stepId: step.stepId,
              applyTo(targetContext) {
                targetContext.setSection("overview", context.getSection("overview"));
              }
            };
          }

          if (step.stepId === "step2-dependencies-boundaries") {
            context.setSection(
              "dependencies-boundaries",
              buildDependenciesResponse(context.filePath)
            );

            return {
              stepId: step.stepId,
              applyTo(targetContext) {
                targetContext.setSection(
                  "dependencies-boundaries",
                  context.getSection("dependencies-boundaries")
                );
              }
            };
          }

          if (step.stepId === "step3-knowledge-source-of-truth") {
            context.setSection(
              "knowledge-source-of-truth",
              buildKnowledgeResponse(context.filePath)
            );

            return {
              stepId: step.stepId,
              applyTo(targetContext) {
                targetContext.setSection(
                  "knowledge-source-of-truth",
                  context.getSection("knowledge-source-of-truth")
                );
              }
            };
          }

          if (step.stepId === "step4-strategy-what-if-scenarios") {
            context.setSection(
              "strategy-what-if-scenarios",
              buildStrategyResponse(context.filePath)
            );

            return {
              stepId: step.stepId,
              applyTo(targetContext) {
                targetContext.setSection(
                  "strategy-what-if-scenarios",
                  context.getSection("strategy-what-if-scenarios")
                );
              }
            };
          }

          context.updateStructuredState({
            findings: [
              {
                type: "must",
                title: "問題標題",
                context: "具體情境",
                deviation: "預期與實際有落差",
                impact: "會造成 correctness 問題",
                suggestion: "補上 guard",
                confidence: 88
              }
            ]
          });

          return {
            stepId: step.stepId,
            applyTo(targetContext) {
              targetContext.updateStructuredState(context.getStructuredState());
            }
          };
        }
      },
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      new RegExp(
        `step1-overview.*${escapeRegExp(failedFile)}.*git diff failed|${escapeRegExp(failedFile)}.*step1-overview.*git diff failed`,
        "u"
      )
    );

    assert.deepEqual(executedSteps, [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step5-validation-interrogation", reviewableFiles[0]],
      ["step6-cognitive-simulation", reviewableFiles[0]]
    ]);

    const firstNote = readFileSync(plannedNotes[0].noteFilePath, "utf8");
    assert.match(firstNote, /^## Findings/mu);
    assert.doesNotMatch(firstNote, /Review not yet generated/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not initialize local output when Step 0 fails", async () => {
  const calls = [];
  const fixture = createReviewRepoFixture();

  try {
    const outputTarget = path.join(fixture.repoDir, "packages", "app", "review");
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: {
        initializeRun() {
          calls.push("initializeRun");
        },
        publishFileReview() {
          calls.push("publishFileReview");
        },
        publishSkippedFile() {
          calls.push("publishSkippedFile");
        }
      },
      stepRunner: {
        async run() {
          throw new Error("should not reach step 1");
        }
      },
      changesetOverviewRunner: {
        async run() {
          throw new Error("Step 0 failed");
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      /Step 0 failed/u
    );

    assert.deepEqual(calls, []);
    assert.equal(existsSync(outputTarget), false);
  } finally {
    fixture.cleanup();
  }
});

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

function buildStrategyResponse(filePath: string, label = filePath): string {
  return [
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    `  - state transition：${label} 這次改動調整了主要執行路徑，值得驗證狀態切換是否一致`,
    "- What-if 假設情境：",
    `  - W1: 觸發條件：${label} 輸入為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 直接調整處理流程`,
    `  - W2: 觸發條件：${label} 依賴回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示 dependency boundary`,
    `  - W3: 觸發條件：${label} 重複執行；預期正確行為：結果應保持穩定；待驗證風險/不確定性：狀態是否累積偏移；與本次改動的關聯：Step 3 已收斂假設與範圍`
  ].join("\n");
}

function buildStep5JsonResponse(): string {
  return JSON.stringify({
    findings: [
      {
        type: "must",
        title: "問題標題",
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
        title: "問題標題",
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 91
      }
    ]
  });
}

function buildStepResponse(
  stepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step3-knowledge-source-of-truth"
    | "step4-strategy-what-if-scenarios"
    | "step5-validation-interrogation"
    | "step6-cognitive-simulation",
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

  return buildStep6JsonResponse();
}

function detectStepId(
  systemMessage: string
):
  | "step1-overview"
  | "step2-dependencies-boundaries"
  | "step3-knowledge-source-of-truth"
  | "step4-strategy-what-if-scenarios"
  | "step5-validation-interrogation"
  | "step6-cognitive-simulation" {
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

  throw new Error(`Unknown step system message: ${systemMessage}`);
}

function extractDiffPath(prompt: string): string {
  const match = prompt.match(/<diff path="([^"]+)"/u);

  if (!match) {
    throw new Error(`Missing diff path in prompt: ${prompt}`);
  }

  return match[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
