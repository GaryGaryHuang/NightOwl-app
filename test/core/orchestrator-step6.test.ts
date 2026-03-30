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
  loadPlannedNoteContents,
  type StepId
} from "../helpers/orchestrator-step-contract-fixture.ts";
import { buildSimulationStep5JsonResponse, buildSimulationStep6JsonResponse, buildStandardStep7SummaryResponse, detectStepId, escapeRegExp, extractDiffPath, lineRangeTraceability } from "../helpers/orchestrator-fixture.ts";

const buildStepResponse = createStepResponseRouter({
  step5Response() {
    return buildSimulationStep5JsonResponse();
  },
  step6Response() {
    return buildSimulationStep6JsonResponse();
  },
  step7Response(filePath: string) {
    return buildStandardStep7SummaryResponse(filePath);
  }
});

test("ReviewOrchestrator executes Step 1 then Step 2 then Step 3 then Step 4 then Step 5 then Step 6 then Step 7 in filtered changed-file order and passes current review into Step 6", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const observedProfiles: Array<Record<string, string>> = [];
    const observedStepEvents: Array<[StepId, string]> = [];
    const observedPrompts: Array<{ stepId: StepId; prompt: string }> = [];
    const observedDisconnects: string[] = [];
    const sourceProvider = new LocalGitProvider();
    const stepRunner = createObservedStepRunner({
      observedDisconnects,
      observedProfiles,
      observedPrompts,
      observedStepEvents,
      buildStepResponse
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
      userContext: [],
      dryRun: false
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

    const step6Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step6-cognitive-simulation"
    );

    assert.match(
      step6Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Findings[\s\S]*\[must\] 初版 findings/u
    );
    assert.doesNotMatch(step6Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.filesPath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      const noteContent = plannedNote.content;

      assert.match(noteContent, /^## Findings/mu);
      assert.match(
        noteContent,
        /## Strategy & What-if Scenarios[\s\S]*## Findings/u
      );
      assert.match(noteContent, /\[must\] 最終 findings/u);
      assert.doesNotMatch(noteContent, /\[must\] 初版 findings/u);
      assert.doesNotMatch(noteContent, /confidence/u);
      assert.match(noteContent, /^## Summary/mu);
      assert.match(noteContent, /## Findings[\s\S]*## Summary/u);
      assert.doesNotMatch(noteContent, /pending/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator passes explicit empty Step 5 findings into Step 6 and allows Step 6 to replace them with final findings", async () => {
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
                  return { data: { content: JSON.stringify({ findings: [] }) } };
                }

                if (stepId === "step6-cognitive-simulation") {
                  return {
                    data: {
                      content: JSON.stringify({
                        findings: [
                          {
                            type: "must",
                            title: `Step6 restored ${filePath}`,
                            traceability: lineRangeTraceability(30, 32),
                            context: "模擬路徑重新確認",
                            deviation: "first-pass 未涵蓋最終偏差",
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
      userContext: [],
      dryRun: false
    });

    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const step6Prompts = observedPrompts.filter(
      ({ stepId }) => stepId === "step6-cognitive-simulation"
    );

    assert.ok(step6Prompts.length > 0);
    for (const prompt of step6Prompts) {
      assert.match(prompt.prompt, /<current_review>[\s\S]*## Findings\n- 無/u);
      assert.doesNotMatch(prompt.prompt, /無 findings\./u);
    }

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /^## Findings/mu);
      assert.match(noteContent, /\[must\] Step6 restored/u);
      assert.doesNotMatch(noteContent, /## Findings\n- 無/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator uses the same configured thresholds for Step 5 and Step 6", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const observedPrompts: Array<{ stepId: string; prompt: string }> = [];
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
                observedPrompts.push({ stepId, prompt: options.prompt });

                if (stepId === "step5-validation-interrogation") {
                  return {
                    data: {
                      content: JSON.stringify({
                        findings: [
                          {
                            type: "must",
                            title: "低門檻 step5 must",
                            traceability: lineRangeTraceability(14, 18),
                            context: "具體情境",
                            deviation: "預期與實際有落差",
                            impact: "影響 correctness",
                            suggestion: "補上 guard",
                            confidence: 75
                          },
                          {
                            type: "nice",
                            title: "低門檻 step5 nice",
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
                            title: "低門檻 step6 must",
                            traceability: lineRangeTraceability(30, 32),
                            context: "模擬路徑重新確認",
                            deviation: "最終偏差確認",
                            impact: "會造成 correctness 問題",
                            suggestion: "補上 final guard",
                            confidence: 75
                          },
                          {
                            type: "nice",
                            title: "低門檻 step6 nice",
                            traceability: lineRangeTraceability(34, 35),
                            context: "模擬路徑重新確認",
                            deviation: "最終偏差確認",
                            impact: "影響可維護性",
                            suggestion: "補上整理",
                            confidence: 88
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    const step6Prompts = observedPrompts.filter(
      ({ stepId }) => stepId === "step6-cognitive-simulation"
    );
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);

    assert.ok(step6Prompts.length > 0);
    for (const prompt of step6Prompts) {
      assert.match(prompt.prompt, /\[must\] 低門檻 step5 must/u);
      assert.match(prompt.prompt, /\[nice\] 低門檻 step5 nice/u);
    }

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /\[must\] 低門檻 step6 must/u);
      assert.match(noteContent, /\[nice\] 低門檻 step6 nice/u);
      assert.doesNotMatch(noteContent, /confidence/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator renders `## Findings` with `- 無` when Step 6 clears prior Step 5 findings", async () => {
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
      userContext: [],
      dryRun: false
    });

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /^## Findings/mu);
      assert.match(noteContent, /## Findings\n- 無/u);
      assert.doesNotMatch(noteContent, /無 findings\./u);
      assert.doesNotMatch(noteContent, /初版 findings/u);
      assert.doesNotMatch(noteContent, /confidence/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 6 for a failed Step 5 file and continues later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step5 gating");

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
                  stepId === "step5-validation-interrogation" &&
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.equal(result.plannedFileCount, reviewableFiles.length);

    assert.deepEqual(observedStepEvents.slice(0, 13), [
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
      ["step5-validation-interrogation", failedFile]
    ]);
    assert.equal(
      reviewAttempts.get(`step6-cognitive-simulation:${failedFile}`),
      undefined
    );

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

test("ReviewOrchestrator retries Step 6 after deterministic validation failure and publishes only the successful retry snapshot", async () => {
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

                if (stepId !== "step6-cognitive-simulation") {
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
                          title: `${filePath} final attempt ${attempt}`,
                          traceability: lineRangeTraceability(30, 32),
                          context: "具體情境",
                          deviation: "預期與實際有落差",
                          impact: "會造成 correctness 問題",
                          suggestion: "補上 final guard",
                          confidence: 91
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
      userContext: [],
      dryRun: false
    });

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const retriedNote = plannedNotes.find(({ filePath }) => filePath === retryFile)!;
    const retriedContent = readFileSync(retriedNote.noteFilePath, "utf8");

    assert.equal(reviewAttempts.get(`step6-cognitive-simulation:${retryFile}`), 2);
    assert.equal(judgeCallsByStep.get("step6-cognitive-simulation") ?? 0, 0);
    assert.match(retriedContent, /final attempt 2/u);
    assert.doesNotMatch(retriedContent, /final attempt 1/u);
    assert.doesNotMatch(retriedContent, /初版 findings/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 6 after malformed JSON retry exhaustion and preserves the Step 5 snapshot", async () => {
  await assertStep6Failure({
    title: "step6 malformed json",
    expectedErrorPattern:
      /step6-cognitive-simulation.*deterministic validation failed|deterministic validation failed.*step6-cognitive-simulation/u,
    expectedReason: "deterministic validation failed",
    step6ReviewFailure() {
      return { data: { content: "{\"findings\":[}" } };
    }
  });
});

test("ReviewOrchestrator aborts Step 6 after extra trailing text retry exhaustion and preserves the Step 5 snapshot", async () => {
  await assertStep6Failure({
    title: "step6 extra trailing text",
    expectedErrorPattern:
      /step6-cognitive-simulation.*deterministic validation failed|deterministic validation failed.*step6-cognitive-simulation/u,
    expectedReason: "deterministic validation failed",
    step6ReviewFailure() {
      return {
        data: {
          content: "{\"findings\": []}\nextra trailing text"
        }
      };
    }
  });
});

test("ReviewOrchestrator aborts Step 6 after schema-invalid JSON retry exhaustion and preserves the Step 5 snapshot", async () => {
  await assertStep6Failure({
    title: "step6 schema invalid",
    expectedErrorPattern:
      /step6-cognitive-simulation.*deterministic validation failed|deterministic validation failed.*step6-cognitive-simulation/u,
    expectedReason: "deterministic validation failed",
    step6ReviewFailure() {
      return {
        data: {
          content: JSON.stringify({
            findings: [
              {
                type: "must",
                title: "",
                traceability: lineRangeTraceability(30, 32),
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

test("ReviewOrchestrator aborts Step 6 after empty review response retry exhaustion and preserves the Step 5 snapshot", async () => {
  await assertStep6Failure({
    title: "step6 empty response",
    expectedErrorPattern:
      /step6-cognitive-simulation.*empty review response|empty review response.*step6-cognitive-simulation/u,
    expectedReason: "empty review response",
    step6ReviewFailure() {
      return { data: { content: "   " } };
    }
  });
});

test("ReviewOrchestrator aborts Step 6 after review timeout retry exhaustion and preserves the Step 5 snapshot", async () => {
  await assertStep6Failure({
    title: "step6 review timeout",
    expectedErrorPattern:
      /step6-cognitive-simulation.*review timeout|review timeout.*step6-cognitive-simulation/u,
    expectedReason: "review timeout",
    step6ReviewFailure() {
      throw new Error("review timeout");
    }
  });
});

test("ReviewOrchestrator skips Step 6 after review startup failure retry exhaustion and preserves the Step 5 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step6 startup failure");

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
              /## Current Step: Cognitive Simulation/u.test(profile.systemMessage) &&
              (sessionCount === 13 || sessionCount === 14)
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
      userContext: [],
      dryRun: false
    });

    assert.equal(sessionCount, reviewableFiles.length * 7);

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const failedNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    const laterNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === reviewableFiles[2])!.noteFilePath,
      "utf8"
    );

    assert.match(failedNote, /step6-cognitive-simulation/u);
    assert.match(failedNote, /review startup failed/u);
    assert.match(laterNote, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

async function assertStep6Failure(input: {
  title: string;
  expectedErrorPattern: RegExp;
  expectedReason: string;
  step6ReviewFailure(): { data?: { content?: string } } | never;
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

                if (stepId !== "step6-cognitive-simulation") {
                  return { data: { content: buildStepResponse(stepId, filePath) } };
                }

                if (filePath === failedFile) {
                  return input.step6ReviewFailure();
                }

                return {
                  data: {
                    content: buildSimulationStep6JsonResponse()
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
      userContext: [],
      dryRun: false
    });

    assert.equal(reviewAttempts.get(`step6-cognitive-simulation:${failedFile}`), 2);
    assert.equal(judgeCallsByStep.get("step6-cognitive-simulation") ?? 0, 0);

    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === successfulFile
    )!;
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile)!;

    const successfulNoteContent = readFileSync(successfulNote.noteFilePath, "utf8");
    assert.match(successfulNoteContent, /^## Summary/mu);

    const failedNoteContent = readFileSync(failedNote.noteFilePath, "utf8");
    assert.match(failedNoteContent, /^## Findings/mu);
    assert.match(failedNoteContent, /初版 findings/u);
    assert.doesNotMatch(failedNoteContent, /最終 findings/u);
    assert.doesNotMatch(failedNoteContent, /Review not yet generated/u);
    assert.match(failedNoteContent, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNoteContent, /step6-cognitive-simulation/u);
    assert.match(failedNoteContent, new RegExp(escapeRegExp(input.expectedReason), "u"));

    const laterNoteContent = readFileSync(laterNote.noteFilePath, "utf8");
    assert.match(laterNoteContent, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
}
