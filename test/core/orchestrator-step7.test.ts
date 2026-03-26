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
import { buildDependenciesResponse, buildKnowledgeResponse, buildOverviewResponse, buildStrategyResponse, detectStepId, escapeRegExp, lineRangeTraceability } from "../helpers/orchestrator-fixture.ts";

test("ReviewOrchestrator executes Step 1 then Step 2 then Step 3 then Step 4 then Step 5 then Step 6 then Step 7 in filtered changed-file order and passes current review into Step 7", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const observedProfiles: Array<Record<string, string>> = [];
    const observedStepEvents: Array<[string, string]> = [];
    const observedPrompts: Array<{ stepId: string; prompt: string }> = [];
    const observedDisconnects: string[] = [];
    const sourceProvider = new LocalGitProvider();
    const stepRunner = createSevenStepRunner({
      observedDisconnects,
      observedProfiles,
      observedPrompts,
      observedStepEvents
    });
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner,
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

    const outputBaseDir = path.join(fixture.repoDir, "packages", "app");
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);

    assert.equal(result.repoRoot, repoRoot);
    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.deepEqual(
      observedStepEvents,
      reviewableFiles.flatMap((filePath) => [
        ["step1-overview", filePath],
        ["step2-dependencies-boundaries", filePath],
        ["step3-knowledge-source-of-truth", filePath],
        ["step4-strategy-what-if-scenarios", filePath],
        ["step5-validation-interrogation", filePath],
        ["step6-cognitive-simulation", filePath],
        ["step7-summary", filePath]
      ])
    );
    assert.equal(observedDisconnects.length, reviewableFiles.length * 7);
    assert.equal(observedProfiles.length, reviewableFiles.length * 7);

    for (const profile of observedProfiles) {
      assert.equal(profile.outputBaseDir, outputBaseDir);
      assert.equal(profile.repoRoot, repoRoot);
      assert.equal(profile.workingDirectory, repoRoot);

      if (
        /## Current Step: Overview/u.test(profile.systemMessage) ||
        /## Current Step: Knowledge & Source of Truth/u.test(profile.systemMessage) ||
        /## Current Step: Summary/u.test(profile.systemMessage)
      ) {
        assert.equal(profile.model, "gpt-5-mini");
      } else {
        assert.equal(profile.model, "gpt-5.4-mini");
      }
    }

    const step7Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step7-summary"
    );

    assert.match(
      step7Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Findings[\s\S]*\[must\] 最終 findings/u
    );
    assert.doesNotMatch(step7Prompt?.prompt ?? "", /<diff/u);
    assert.doesNotMatch(step7Prompt?.prompt ?? "", /<changeset_context>/u);
    assert.doesNotMatch(step7Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.filesPath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /^## Summary/mu);
      assert.match(noteContent, /## Findings[\s\S]*## Summary/u);
      assert.match(noteContent, /### 審查基礎/u);
      assert.match(noteContent, /### 行為變更提醒/u);
      assert.match(noteContent, /### 風險評估/u);
      assert.match(noteContent, /\[must\] 最終 findings/u);
      assert.doesNotMatch(noteContent, /Step 8|aggregate summary|pending/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator passes explicit empty Step 6 findings into Step 7 and still publishes Summary", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const observedPrompts: Array<{ stepId: string; prompt: string }> = [];
    const sourceProvider = new LocalGitProvider();
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
                observedPrompts.push({ stepId, prompt: options.prompt });

                if (stepId === "step6-cognitive-simulation") {
                  return { data: { content: JSON.stringify({ findings: [] }) } };
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const step7Prompts = observedPrompts.filter(({ stepId }) => stepId === "step7-summary");

    assert.ok(step7Prompts.length > 0);
    for (const prompt of step7Prompts) {
      assert.match(prompt.prompt, /<current_review>[\s\S]*## Findings\n- 無/u);
      assert.doesNotMatch(prompt.prompt, /無 findings\./u);
      assert.doesNotMatch(prompt.prompt, /<diff/u);
      assert.doesNotMatch(prompt.prompt, /<changeset_context>/u);
    }

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /## Findings\n- 無[\s\S]*## Summary/u);
      assert.doesNotMatch(noteContent, /無 findings\./u);
      assert.match(noteContent, /### 風險評估/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator still succeeds with zero planned files and does not create Step 1 through Step 7 sessions", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\nsrc/**\npackages/**\n");

    let createSessionCalls = 0;
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession() {
            createSessionCalls += 1;

            return new SessionExecutor({
              async sendAndWait() {
                return {
                  data: {
                    content: buildOverviewResponse("unexpected.ts")
                  }
                };
              },
              async disconnect() {}
            });
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(result.plannedFileCount, 0);
    assert.equal(createSessionCalls, 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 7 for a failed Step 6 file and continues later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step6 gating");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const observedStepEvents: Array<[string, string]> = [];
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
                observedStepEvents.push([stepId, filePath]);

                if (
                  stepId === "step6-cognitive-simulation" &&
                  filePath === failedFile
                ) {
                  return { data: { content: "{\"findings\":[}" } };
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(result.plannedFileCount, reviewableFiles.length);

    assert.deepEqual(observedStepEvents.slice(0, 14), [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step5-validation-interrogation", reviewableFiles[0]],
      ["step6-cognitive-simulation", reviewableFiles[0]],
      ["step7-summary", reviewableFiles[0]],
      ["step1-overview", failedFile],
      ["step2-dependencies-boundaries", failedFile],
      ["step3-knowledge-source-of-truth", failedFile],
      ["step4-strategy-what-if-scenarios", failedFile],
      ["step5-validation-interrogation", failedFile],
      ["step6-cognitive-simulation", failedFile],
      ["step6-cognitive-simulation", failedFile]
    ]);
    assert.equal(reviewAttempts.get(`step7-summary:${failedFile}`), undefined);

    const laterNote = readFileSync(
      planNoteFiles(result.outputTarget.filesPath, reviewableFiles).find(
        ({ filePath }) => filePath === reviewableFiles[2]
      )!.noteFilePath,
      "utf8"
    );
    assert.match(laterNote, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 7 after judge rejection and publishes only the successful retry snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const reviewAttempts = new Map();
    const judgeAttempts = new Map();
    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const retryFile = reviewableFiles[1];
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
                return {
                  data: {
                    content:
                      stepId === "step7-summary"
                        ? buildSummaryResponse(filePath, `${filePath} attempt ${attempt}`)
                        : buildStepResponse(stepId, filePath)
                  }
                };
              },
              async disconnect() {}
            });
          }
        },
        structuredOutputValidator: new StructuredOutputValidator(),
        judgeService: {
          async evaluate(input) {
            const key = `${input.stepId}:${input.filePath}`;
            const attempt = (judgeAttempts.get(key) ?? 0) + 1;

            judgeAttempts.set(key, attempt);

            if (
              input.stepId === "step7-summary" &&
              input.filePath === retryFile &&
              attempt === 1
            ) {
              return { passed: false, cause: "judge rejected" };
            }

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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const retriedNote = plannedNotes.find(({ filePath }) => filePath === retryFile)!;
    const retriedContent = readFileSync(retriedNote.noteFilePath, "utf8");

    assert.equal(reviewAttempts.get(`step7-summary:${retryFile}`), 2);
    assert.equal(judgeAttempts.get(`step7-summary:${retryFile}`), 2);
    assert.match(retriedContent, /attempt 2/u);
    assert.doesNotMatch(retriedContent, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator skips Step 7 after judge rejection retry exhaustion and preserves the Step 6 snapshot", async () => {
  await assertStep7Failure({
    title: "step7 judge rejection",
    expectedErrorPattern:
      /step7-summary.*judge rejected|judge rejected.*step7-summary/u,
    expectedReason: "judge rejected",
    judgeFailureCause: "judge rejected"
  });
});

test("ReviewOrchestrator skips Step 7 after judge timeout retry exhaustion and preserves the Step 6 snapshot", async () => {
  await assertStep7Failure({
    title: "step7 judge timeout",
    expectedErrorPattern:
      /step7-summary.*judge timeout|judge timeout.*step7-summary/u,
    expectedReason: "judge timeout",
    judgeFailureCause: "judge timeout"
  });
});

test("ReviewOrchestrator skips Step 7 after review timeout retry exhaustion and preserves the Step 6 snapshot", async () => {
  await assertStep7Failure({
    title: "step7 review timeout",
    expectedErrorPattern:
      /step7-summary.*review timeout|review timeout.*step7-summary/u,
    expectedReason: "review timeout",
    reviewFailure() {
      throw new Error("review timeout");
    }
  });
});

test("ReviewOrchestrator skips Step 7 after empty review response retry exhaustion and preserves the Step 6 snapshot", async () => {
  await assertStep7Failure({
    title: "step7 empty response",
    expectedErrorPattern:
      /step7-summary.*empty review response|empty review response.*step7-summary/u,
    expectedReason: "empty review response",
    reviewFailure() {
      return { data: { content: "   " } };
    }
  });
});

test("ReviewOrchestrator skips Step 7 after review startup failure retry exhaustion and preserves the Step 6 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step7 startup failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    let sessionCount = 0;
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession(profile) {
            sessionCount += 1;

            if (
              /## Current Step: Summary/u.test(profile.systemMessage) &&
              (sessionCount === 14 || sessionCount === 15)
            ) {
              throw new Error("review startup failed");
            }

            const stepId = detectStepId(profile.systemMessage);

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(sessionCount, reviewableFiles.length * 7 + 1);

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const failedNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    const laterNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === reviewableFiles[2])!.noteFilePath,
      "utf8"
    );

    assert.match(failedNote, /step7-summary/u);
    assert.match(failedNote, /review startup failed/u);
    assert.match(laterNote, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

async function assertStep7Failure(input: {
  title: string;
  expectedErrorPattern: RegExp;
  expectedReason: string;
  judgeFailureCause?: "judge rejected" | "judge timeout";
  reviewFailure?: () => { data?: { content?: string } } | never;
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
    const outputBaseDir = path.join(fixture.repoDir, "packages", "app");
    const plannedNotes = planNoteFiles(
      path.join(outputBaseDir, "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const successfulFile = reviewableFiles[0];
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const reviewAttempts = new Map();
    const judgeCallsByStep = new Map();
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

                if (stepId === "step7-summary" && filePath === failedFile) {
                  if (input.reviewFailure) {
                    return input.reviewFailure();
                  }

                  return {
                    data: {
                      content: buildSummaryResponse(filePath)
                    }
                  };
                }

                return { data: { content: buildStepResponse(stepId, filePath) } };
              },
              async disconnect() {}
            });
          }
        },
        structuredOutputValidator: new StructuredOutputValidator(),
        judgeService: {
          async evaluate(inputJudge) {
            judgeCallsByStep.set(
              inputJudge.stepId,
              (judgeCallsByStep.get(inputJudge.stepId) ?? 0) + 1
            );

            if (
              inputJudge.stepId === "step7-summary" &&
              inputJudge.filePath === failedFile &&
              input.judgeFailureCause
            ) {
              return { passed: false, cause: input.judgeFailureCause };
            }

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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(reviewAttempts.get(`step7-summary:${failedFile}`), 2);
    assert.equal(reviewAttempts.get(`step7-summary:${laterFile}`), 1);

    const successfulNote = plannedNotes.find(({ filePath }) => filePath === successfulFile)!;
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile)!;

    const successfulNoteContent = readFileSync(successfulNote.noteFilePath, "utf8");
    assert.match(successfulNoteContent, /^## Summary/mu);

    const failedNoteContent = readFileSync(failedNote.noteFilePath, "utf8");
    assert.match(failedNoteContent, /^## Findings/mu);
    assert.doesNotMatch(failedNoteContent, /^## Summary/mu);
    assert.doesNotMatch(failedNoteContent, /Review not yet generated/u);
    assert.match(failedNoteContent, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNoteContent, /step7-summary/u);
    assert.match(failedNoteContent, new RegExp(escapeRegExp(input.expectedReason), "u"));

    const laterNoteContent = readFileSync(laterNote.noteFilePath, "utf8");
    assert.match(laterNoteContent, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
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

function buildSummaryResponse(filePath: string, label = filePath): string {
  return [
    "## Summary",
    "### 審查基礎",
    `- 改動概要：${label} 這次改動主要調整執行流程與輸入處理。`,
    `- 依據規範：依 repo 內版本檔、${label} 相關 source-of-truth 以及既有契約進行審查。`,
    "- 審查假設：以 repo 內已建立的版本假設與排除範圍為準，未額外擴張到外部知識查證。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    "- 整體風險等級：Medium",
    `- 風險理由：${label} 仍存在需關注的 final findings，且其風險判斷受到目前審查假設與範圍邊界影響。`
  ].join("\n");
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

function extractDiffPath(prompt: string): string {
  const diffMatch = prompt.match(/<diff path="([^"]+)"/u);

  if (diffMatch) {
    return diffMatch[1];
  }

  const sourceMatch = prompt.match(/- Source file: `([^`]+)`/u);

  if (sourceMatch) {
    return sourceMatch[1];
  }

  throw new Error(`Unable to find file path in prompt: ${prompt}`);
}

function createSevenStepRunner(input: {
  observedDisconnects: string[];
  observedProfiles: Array<Record<string, string>>;
  observedPrompts: Array<Record<string, string>>;
  observedStepEvents: Array<[string, string]>;
}): StepRunner {
  return new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        input.observedProfiles.push(profile);
        const stepId = detectStepId(profile.systemMessage);

        return new SessionExecutor({
          async sendAndWait(options) {
            const filePath = extractDiffPath(options.prompt);
            input.observedPrompts.push({ stepId, prompt: options.prompt });
            input.observedStepEvents.push([stepId, filePath]);

            return {
              data: {
                content: buildStepResponse(stepId, filePath)
              }
            };
          },
          async disconnect() {
            input.observedDisconnects.push(stepId);
          }
        });
      }
    },
    structuredOutputValidator: new StructuredOutputValidator(),
    judgeService: {
      async evaluate() {
        return { passed: true };
      }
    }
  });
}
