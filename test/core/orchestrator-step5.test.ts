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
import {
  assertObservedProfilesUseExpectedModels,
  collectReviewableFiles,
  createObservedStepRunner,
  createStepResponseRouter,
  loadPlannedNoteContents
} from "../helpers/orchestrator-step-contract-fixture.ts";
import { buildDependenciesResponse, buildKnowledgeResponse, buildOverviewResponse, buildStandardStep6JsonResponse, buildStandardStep7SummaryResponse, buildStrategyResponse, detectStepId, escapeRegExp, extractDiffPath, lineRangeTraceability } from "../helpers/orchestrator-fixture.ts";

const buildStepResponse = createStepResponseRouter({
  step5Response() {
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
  },
  step6Response() {
    return buildStandardStep6JsonResponse();
  },
  step7Response(filePath: string) {
    return buildStandardStep7SummaryResponse(filePath);
  }
});

test("ReviewOrchestrator executes Step 1 then Step 2 then Step 3 then Step 4 then Step 5 then Step 6 then Step 7 in filtered changed-file order and passes current review into Step 5", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const observedProfiles: Array<Record<string, string>> = [];
    const observedStepEvents: Array<[string, string]> = [];
    const observedPrompts: Array<{ stepId: string; prompt: string }> = [];
    const observedDisconnects: string[] = [];
    const sourceProvider = new LocalGitProvider();
    const stepRunner = createObservedStepRunner({
      observedDisconnects,
      observedProfiles,
      observedPrompts,
      observedStepEvents,
      buildStepResponse,
      disconnectValue: () => "disconnect",
      expectedTimeoutMs: 300_000,
      structuredOutputValidator: {
        validate() {
          return {
            findings: [
              {
                type: "must",
                title: "問題標題",
                traceability: lineRangeTraceability(14, 18),
                context: "具體情境",
                deviation: "預期與實際有落差",
                impact: "會造成 correctness 問題",
                suggestion: "補上 guard",
                confidence: 88
              }
            ]
          };
        }
      }
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
    const { repoRoot, reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      repoDir: fixture.repoDir
    });
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

    assertObservedProfilesUseExpectedModels(observedProfiles, outputBaseDir, repoRoot);

    const step5Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step5-validation-interrogation"
    );

    assert.match(
      step5Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Strategy & What-if Scenarios/u
    );
    assert.doesNotMatch(step5Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.doesNotMatch(step5Prompt?.prompt ?? "", /^## Findings/mu);
    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.filesPath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      const noteContent = plannedNote.content;

      assert.match(noteContent, /^## Strategy & What-if Scenarios/mu);
      assert.match(noteContent, /^## Findings/mu);
      assert.match(
        noteContent,
        /## Strategy & What-if Scenarios[\s\S]*## Findings/u
      );
      assert.doesNotMatch(noteContent, /confidence/u);
      assert.match(noteContent, /^## Summary/mu);
      assert.match(noteContent, /## Findings[\s\S]*## Summary/u);
      assert.doesNotMatch(noteContent, /pending/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 5 for a failed Step 4 file and continues later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step4 gating");

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
                  stepId === "step4-strategy-what-if-scenarios" &&
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
        structuredOutputValidator: {
          validate() {
            return {
              findings: [
                {
                  type: "must",
                  title: "問題標題",
                  traceability: lineRangeTraceability(14, 18),
                  context: "具體情境",
                  deviation: "預期與實際有落差",
                  impact: "會造成 correctness 問題",
                  suggestion: "補上 guard",
                  confidence: 88
                }
              ]
            };
          }
        },
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

    assert.deepEqual(observedStepEvents.slice(0, 12), [
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
      ["step4-strategy-what-if-scenarios", failedFile]
    ]);
    assert.equal(
      reviewAttempts.get(`step5-validation-interrogation:${failedFile}`),
      undefined
    );
    assert.equal(
      reviewAttempts.get(`step6-cognitive-simulation:${failedFile}`),
      undefined
    );
    assert.equal(
      reviewAttempts.get(`step7-summary:${failedFile}`),
      undefined
    );
  } finally {
    fixture.cleanup();
  }
});
test("ReviewOrchestrator renders `## Findings` with `- 無` when Step 5 returns an empty findings array", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
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
                return {
                  data: {
                    content:
                      stepId === "step5-validation-interrogation" ||
                      stepId === "step6-cognitive-simulation"
                        ? JSON.stringify({ findings: [] })
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

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /^## Findings/mu);
      assert.match(noteContent, /## Findings\n- 無/u);
      assert.doesNotMatch(noteContent, /無 findings\./u);
      assert.doesNotMatch(noteContent, /confidence/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator treats confidence-filtered empty findings as a successful Step 5 outcome", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
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
                return {
                  data: {
                    content:
                      stepId === "step5-validation-interrogation"
                        ? JSON.stringify({
                            findings: [
                              {
                                type: "must",
                                title: "低信心 must",
                                traceability: lineRangeTraceability(14, 18),
                                context: "具體情境",
                                deviation: "預期與實際有落差",
                                impact: "會造成 correctness 問題",
                                suggestion: "補上 guard",
                                confidence: 79
                              },
                              {
                                type: "nice",
                                title: "低信心 nice",
                                traceability: lineRangeTraceability(20, 20),
                                context: "具體情境",
                                deviation: "可改善",
                                impact: "影響可維護性",
                                suggestion: "補上整理",
                                confidence: 89
                              }
                            ]
                          })
                        : stepId === "step6-cognitive-simulation"
                          ? JSON.stringify({ findings: [] })
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

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /^## Findings/mu);
      assert.match(noteContent, /## Findings\n- 無/u);
      assert.doesNotMatch(noteContent, /無 findings\./u);
      assert.doesNotMatch(noteContent, /低信心 must|低信心 nice/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator uses configured thresholds when Step 5 filters findings into the Step 6 prompt", async () => {
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

                if (stepId === "step5-validation-interrogation") {
                  return {
                    data: {
                      content: JSON.stringify({
                        findings: [
                          {
                            type: "must",
                            title: "低門檻 must",
                            traceability: lineRangeTraceability(14, 18),
                            context: "具體情境",
                            deviation: "預期與實際有落差",
                            impact: "影響 correctness",
                            suggestion: "補上 guard",
                            confidence: 75
                          },
                          {
                            type: "nice",
                            title: "低門檻 nice",
                            traceability: lineRangeTraceability(20, 20),
                            context: "具體情境",
                            deviation: "可改善",
                            impact: "影響可維護性",
                            suggestion: "補上整理",
                            confidence: 88
                          }
                        ]
                      })
                    }
                  };
                }

                if (stepId === "step6-cognitive-simulation") {
                  return {
                    data: {
                      content: JSON.stringify({
                        findings: [
                          {
                            type: "must",
                            title: `Step6 must ${filePath}`,
                            traceability: lineRangeTraceability(30, 32),
                            context: "模擬路徑重新確認",
                            deviation: "最終偏差確認",
                            impact: "會造成 correctness 問題",
                            suggestion: "補上 final guard",
                            confidence: 91
                          }
                        ]
                      })
                    }
                  };
                }

                return { data: { content: buildStepResponse(stepId, filePath) } };
              },
              async disconnect() {}
            });
          }
        },
        structuredOutputValidator: new StructuredOutputValidator({
          confidenceThresholds: {
            must: 70,
            nice: 85
          }
        }),
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

    await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    const step6Prompts = observedPrompts.filter(
      ({ stepId }) => stepId === "step6-cognitive-simulation"
    );

    assert.ok(step6Prompts.length > 0);
    for (const prompt of step6Prompts) {
      assert.match(prompt.prompt, /\[must\] 低門檻 must/u);
      assert.match(prompt.prompt, /\[nice\] 低門檻 nice/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 5 after deterministic validation failure and publishes only the successful retry snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const reviewAttempts = new Map();
    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const retryFile = reviewableFiles[1];
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

                if (stepId === "step6-cognitive-simulation") {
                  return {
                    data: {
                      content: JSON.stringify({
                        findings: [
                          {
                            type: "must",
                            title: `${filePath} attempt 2`,
                            traceability: lineRangeTraceability(30, 32),
                            context: "具體情境",
                            deviation: "預期與實際有落差",
                            impact: "會造成 correctness 問題",
                            suggestion: "補上 guard",
                            confidence: 91
                          }
                        ]
                      })
                    }
                  };
                }

                if (stepId !== "step5-validation-interrogation") {
                  return { data: { content: buildStepResponse(stepId, filePath) } };
                }

                if (filePath === retryFile && attempt === 1) {
                  return { data: { content: "{\"findings\":[}" } };
                }

                return {
                  data: {
                    content: JSON.stringify({
                      findings: [
                        {
                          type: "must",
                          title: `${filePath} attempt ${attempt}`,
                          traceability: lineRangeTraceability(14, 18),
                          context: "具體情境",
                          deviation: "預期與實際有落差",
                          impact: "會造成 correctness 問題",
                          suggestion: "補上 guard",
                          confidence: 88
                        }
                      ]
                    })
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
            judgeCallsByStep.set(
              input.stepId,
              (judgeCallsByStep.get(input.stepId) ?? 0) + 1
            );
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

    assert.equal(reviewAttempts.get(`step5-validation-interrogation:${retryFile}`), 2);
    assert.equal(judgeCallsByStep.get("step5-validation-interrogation") ?? 0, 0);
    assert.match(retriedContent, /attempt 2/u);
    assert.doesNotMatch(retriedContent, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 5 after malformed JSON retry exhaustion and preserves the Step 4 snapshot", async () => {
  await assertStep5Failure({
    title: "step5 malformed json",
    expectedReason: "deterministic validation failed",
    step5ReviewFailure() {
      return { data: { content: "{\"findings\":[}" } };
    }
  });
});

test("ReviewOrchestrator aborts Step 5 after schema-invalid JSON retry exhaustion and preserves the Step 4 snapshot", async () => {
  await assertStep5Failure({
    title: "step5 schema invalid",
    expectedReason: "deterministic validation failed",
    step5ReviewFailure() {
      return {
        data: {
          content: JSON.stringify({
            findings: [
              {
                type: "must",
                title: "",
                traceability: lineRangeTraceability(14, 18),
                context: "具體情境",
                deviation: "預期與實際有落差",
                impact: "會造成 correctness 問題",
                suggestion: "補上 guard",
                confidence: 88
              }
            ]
          })
        }
      };
    }
  });
});

test("ReviewOrchestrator aborts Step 5 after empty review response retry exhaustion and preserves the Step 4 snapshot", async () => {
  await assertStep5Failure({
    title: "step5 empty response",
    expectedReason: "empty review response",
    step5ReviewFailure() {
      return { data: { content: "   " } };
    }
  });
});

test("ReviewOrchestrator aborts Step 5 after review timeout retry exhaustion and preserves the Step 4 snapshot", async () => {
  await assertStep5Failure({
    title: "step5 review timeout",
    expectedReason: "review timeout",
    step5ReviewFailure() {
      throw new Error("review timeout");
    }
  });
});

test("ReviewOrchestrator skips Step 5 after review startup failure retry exhaustion and preserves the Step 4 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step5 startup failure");

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
              /## Current Step: Validation & Interrogation/u.test(profile.systemMessage) &&
              (sessionCount === 12 || sessionCount === 13)
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

    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.ok(sessionCount <= reviewableFiles.length * 7 - 1);

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const failedNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    assert.match(failedNote, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(failedNote, /^## Findings/mu);
    assert.match(failedNote, /step5-validation-interrogation/u);
    assert.match(failedNote, /review startup failed/u);
  } finally {
    fixture.cleanup();
  }
});

async function assertStep5Failure(input: {
  title: string;
  expectedReason: string;
  step5ReviewFailure(): { data?: { content?: string } } | never;
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

                if (stepId === "step6-cognitive-simulation") {
                  return { data: { content: buildStandardStep6JsonResponse() } };
                }

                if (stepId !== "step5-validation-interrogation") {
                  return { data: { content: buildStepResponse(stepId, filePath) } };
                }

                if (filePath === failedFile) {
                  return input.step5ReviewFailure();
                }

                return { data: { content: buildStep5JsonResponse() } };
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

    assert.equal(reviewAttempts.get(`step5-validation-interrogation:${failedFile}`), 2);
    assert.equal(judgeCallsByStep.get("step5-validation-interrogation") ?? 0, 0);

    const renderedNotes = plannedNotes.map((note) => ({
      ...note,
      content: readFileSync(note.noteFilePath, "utf8")
    }));
    const failedNotes = renderedNotes.filter(({ content }) =>
      /> \[!WARNING\] Review Interrupted/u.test(content) &&
      /step5-validation-interrogation/u.test(content)
    );

    assert.ok(failedNotes.length >= 1);

    const matchedFailure = failedNotes.find(({ content }) =>
      new RegExp(escapeRegExp(input.expectedReason), "u").test(content)
    );

    assert.ok(matchedFailure, `expected interrupted note containing ${input.expectedReason}`);

    const failedNoteContent = matchedFailure.content;
    assert.match(failedNoteContent, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(failedNoteContent, /^## Findings/mu);
    assert.doesNotMatch(failedNoteContent, /Review not yet generated/u);
    assert.match(failedNoteContent, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNoteContent, /step5-validation-interrogation/u);
    assert.match(failedNoteContent, new RegExp(escapeRegExp(input.expectedReason), "u"));
  } finally {
    fixture.cleanup();
  }
}
