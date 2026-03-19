import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("ReviewOrchestrator executes Step 1 then Step 2 then Step 3 then Step 4 in filtered changed-file order and passes current review into Step 4", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const observedProfiles = [];
    const observedStepEvents = [];
    const observedPrompts = [];
    const observedDisconnects = [];
    const sourceProvider = new LocalGitProvider();
    const stepRunner = createFourStepJudgeBackedStepRunner({
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
        ["step4-strategy-what-if-scenarios", filePath]
      ])
    );
    assert.equal(observedDisconnects.length, reviewableFiles.length * 4);
    assert.equal(observedProfiles.length, reviewableFiles.length * 4);

    for (const profile of observedProfiles) {
      assert.equal(profile.outputBaseDir, outputBaseDir);
      assert.equal(profile.repoRoot, repoRoot);
      assert.equal(profile.workingDirectory, repoRoot);

      if (/## Current Step: Overview/u.test(profile.systemMessage)) {
        assert.equal(profile.model, "gpt-5-mini");
      } else if (/## Current Step: Dependencies & Boundaries/u.test(profile.systemMessage)) {
        assert.equal(profile.model, "gpt-5.4-mini");
      } else if (/## Current Step: Knowledge & Source of Truth/u.test(profile.systemMessage)) {
        assert.equal(profile.model, "gpt-5-mini");
      } else {
        assert.match(profile.systemMessage, /## Current Step: Strategy & What-if Scenarios/u);
        assert.equal(profile.model, "gpt-5.4-mini");
      }
    }

    const step4Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step4-strategy-what-if-scenarios"
    );

    assert.match(
      step4Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Knowledge & Source of Truth/u
    );
    assert.doesNotMatch(step4Prompt?.prompt ?? "", /Review not yet generated/u);

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /^## Overview/mu);
      assert.match(noteContent, /^## Dependencies & Boundaries/mu);
      assert.match(noteContent, /^## Knowledge & Source of Truth/mu);
      assert.match(noteContent, /^## Strategy & What-if Scenarios/mu);
      assert.match(
        noteContent,
        /## Overview[\s\S]*## Dependencies & Boundaries[\s\S]*## Knowledge & Source of Truth[\s\S]*## Strategy & What-if Scenarios/u
      );
      assert.doesNotMatch(noteContent, /^## Findings/mu);
      assert.doesNotMatch(noteContent, /Review not yet generated/u);
      assert.doesNotMatch(noteContent, /Step 5|Step 6|Step 7|pending/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator still succeeds with zero planned files and does not create Step 1, Step 2, Step 3, or Step 4 sessions", async () => {
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
    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 4 for a failed Step 3 file or any later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step3 gating");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const observedStepEvents = [];
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

                if (stepId === "step1-overview") {
                  return { data: { content: buildOverviewResponse(filePath) } };
                }

                if (stepId === "step2-dependencies-boundaries") {
                  return { data: { content: buildDependenciesResponse(filePath) } };
                }

                if (
                  stepId === "step3-knowledge-source-of-truth" &&
                  filePath === failedFile
                ) {
                  return { data: { content: "   " } };
                }

                return {
                  data: {
                    content:
                      stepId === "step3-knowledge-source-of-truth"
                        ? buildKnowledgeResponse(filePath)
                        : buildStrategyResponse(filePath)
                  }
                };
              },
              async disconnect() {}
            });
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      new RegExp(
        `step3-knowledge-source-of-truth.*${escapeRegExp(failedFile)}|${escapeRegExp(failedFile)}.*step3-knowledge-source-of-truth`,
        "u"
      )
    );

    assert.deepEqual(observedStepEvents, [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step1-overview", failedFile],
      ["step2-dependencies-boundaries", failedFile],
      ["step3-knowledge-source-of-truth", failedFile],
      ["step3-knowledge-source-of-truth", failedFile]
    ]);
    assert.equal(
      reviewAttempts.get(`step4-strategy-what-if-scenarios:${failedFile}`),
      undefined
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 4 after a blank response and publishes only the successful retry snapshot", async () => {
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

                if (stepId === "step1-overview") {
                  return { data: { content: buildOverviewResponse(filePath) } };
                }

                if (stepId === "step2-dependencies-boundaries") {
                  return { data: { content: buildDependenciesResponse(filePath) } };
                }

                if (stepId === "step3-knowledge-source-of-truth") {
                  return { data: { content: buildKnowledgeResponse(filePath) } };
                }

                if (filePath === retryFile && attempt === 1) {
                  return { data: { content: "   " } };
                }

                return {
                  data: {
                    content: buildStrategyResponse(filePath, `${filePath} attempt ${attempt}`)
                  }
                };
              },
              async disconnect() {}
            });
          }
        },
        judgeService: {
          async evaluate(input) {
            const key = `${input.stepId}:${input.filePath}`;
            const attempt = (judgeAttempts.get(key) ?? 0) + 1;

            judgeAttempts.set(key, attempt);
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
    const retriedNote = plannedNotes.find(({ filePath }) => filePath === retryFile);
    const retriedContent = readFileSync(retriedNote.noteFilePath, "utf8");

    assert.equal(reviewAttempts.get(`step4-strategy-what-if-scenarios:${retryFile}`), 2);
    assert.equal(judgeAttempts.get(`step4-strategy-what-if-scenarios:${retryFile}`), 1);
    assert.match(retriedContent, /attempt 2/u);
    assert.doesNotMatch(retriedContent, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 4 after judge rejection and publishes only the successful retry snapshot", async () => {
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
                      stepId === "step1-overview"
                        ? buildOverviewResponse(filePath)
                        : stepId === "step2-dependencies-boundaries"
                          ? buildDependenciesResponse(filePath)
                          : stepId === "step3-knowledge-source-of-truth"
                            ? buildKnowledgeResponse(filePath)
                            : buildStrategyResponse(filePath, `${filePath} attempt ${attempt}`)
                  }
                };
              },
              async disconnect() {}
            });
          }
        },
        judgeService: {
          async evaluate(input) {
            const key = `${input.stepId}:${input.filePath}`;
            const attempt = (judgeAttempts.get(key) ?? 0) + 1;

            judgeAttempts.set(key, attempt);

            if (
              input.stepId === "step4-strategy-what-if-scenarios" &&
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
    const retriedNote = plannedNotes.find(({ filePath }) => filePath === retryFile);
    const retriedContent = readFileSync(retriedNote.noteFilePath, "utf8");

    assert.equal(reviewAttempts.get(`step4-strategy-what-if-scenarios:${retryFile}`), 2);
    assert.equal(judgeAttempts.get(`step4-strategy-what-if-scenarios:${retryFile}`), 2);
    assert.match(retriedContent, /attempt 2/u);
    assert.doesNotMatch(retriedContent, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 4 after review session startup failure retry exhaustion and preserves the Step 3 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step4 startup failure");

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
              /## Current Step: Strategy & What-if Scenarios/u.test(profile.systemMessage) &&
              (sessionCount === 8 || sessionCount === 9)
            ) {
              throw new Error("review startup failed");
            }

            const stepId = detectStepId(profile.systemMessage);

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);

                return {
                  data: {
                    content:
                      stepId === "step1-overview"
                        ? buildOverviewResponse(filePath)
                        : stepId === "step2-dependencies-boundaries"
                          ? buildDependenciesResponse(filePath)
                          : stepId === "step3-knowledge-source-of-truth"
                            ? buildKnowledgeResponse(filePath)
                            : buildStrategyResponse(filePath)
                  }
                };
              },
              async disconnect() {}
            });
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      new RegExp(
        `step4-strategy-what-if-scenarios.*${escapeRegExp(failedFile)}.*review startup failed|${escapeRegExp(failedFile)}.*step4-strategy-what-if-scenarios.*review startup failed`,
        "u"
      )
    );

    assert.equal(sessionCount, 9);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 4 after empty review response retry exhaustion and preserves the Step 3 snapshot", async () => {
  await assertStep4Failure({
    title: "step4 empty response",
    expectedErrorPattern:
      /step4-strategy-what-if-scenarios.*empty review response|empty review response.*step4-strategy-what-if-scenarios/u,
    step4ReviewFailure() {
      return { data: { content: "   " } };
    },
    expectedStep4JudgeAttempts: 0
  });
});

test("ReviewOrchestrator aborts Step 4 after review timeout retry exhaustion and preserves the Step 3 snapshot", async () => {
  await assertStep4Failure({
    title: "step4 review timeout",
    expectedErrorPattern:
      /step4-strategy-what-if-scenarios.*review timeout|review timeout.*step4-strategy-what-if-scenarios/u,
    step4ReviewFailure() {
      throw new Error("review timeout");
    },
    expectedStep4JudgeAttempts: 0
  });
});

test("ReviewOrchestrator aborts Step 4 after judge startup failure retry exhaustion and preserves the Step 3 snapshot", async () => {
  await assertStep4Failure({
    title: "step4 judge startup failure",
    expectedErrorPattern:
      /step4-strategy-what-if-scenarios.*judge startup failed|judge startup failed.*step4-strategy-what-if-scenarios/u,
    step4JudgeFailure() {
      throw new Error("judge startup failed");
    },
    expectedStep4JudgeAttempts: 2
  });
});

test("ReviewOrchestrator aborts Step 4 after judge timeout retry exhaustion and preserves the Step 3 snapshot", async () => {
  await assertStep4Failure({
    title: "step4 judge timeout",
    expectedErrorPattern:
      /step4-strategy-what-if-scenarios.*judge timeout|judge timeout.*step4-strategy-what-if-scenarios/u,
    step4JudgeFailure() {
      throw new Error("judge timeout");
    },
    expectedStep4JudgeAttempts: 2
  });
});

test("ReviewOrchestrator aborts Step 4 after judge rejection retry exhaustion and preserves the Step 3 snapshot", async () => {
  await assertStep4Failure({
    title: "step4 judge rejection",
    expectedErrorPattern:
      /step4-strategy-what-if-scenarios.*judge rejected|judge rejected.*step4-strategy-what-if-scenarios/u,
    step4JudgeFailure() {
      return { passed: false, cause: "judge rejected" };
    },
    expectedStep4JudgeAttempts: 2
  });
});

async function assertStep4Failure(input: {
  title: string;
  expectedErrorPattern: RegExp;
  step4ReviewFailure?: () => { data?: { content?: string } } | never;
  step4JudgeFailure?: () => { passed: boolean; cause?: string } | never;
  expectedStep4JudgeAttempts: number;
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
    const judgeAttempts = new Map();
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

                if (stepId === "step1-overview") {
                  return { data: { content: buildOverviewResponse(filePath) } };
                }

                if (stepId === "step2-dependencies-boundaries") {
                  return { data: { content: buildDependenciesResponse(filePath) } };
                }

                if (stepId === "step3-knowledge-source-of-truth") {
                  return { data: { content: buildKnowledgeResponse(filePath) } };
                }

                if (filePath === failedFile && input.step4ReviewFailure) {
                  return input.step4ReviewFailure();
                }

                return { data: { content: buildStrategyResponse(filePath) } };
              },
              async disconnect() {}
            });
          }
        },
        judgeService: {
          async evaluate(inputJudge) {
            const key = `${inputJudge.stepId}:${inputJudge.filePath}`;
            const attempt = (judgeAttempts.get(key) ?? 0) + 1;

            judgeAttempts.set(key, attempt);

            if (
              inputJudge.stepId === "step4-strategy-what-if-scenarios" &&
              inputJudge.filePath === failedFile &&
              input.step4JudgeFailure
            ) {
              return input.step4JudgeFailure();
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      input.expectedErrorPattern
    );

    assert.equal(reviewAttempts.get(`step4-strategy-what-if-scenarios:${failedFile}`), 2);
    assert.equal(
      judgeAttempts.get(`step4-strategy-what-if-scenarios:${failedFile}`) ?? 0,
      input.expectedStep4JudgeAttempts
    );

    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === successfulFile
    );
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile);
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile);

    const successfulNoteContent = readFileSync(successfulNote.noteFilePath, "utf8");
    assert.match(successfulNoteContent, /^## Overview/mu);
    assert.match(successfulNoteContent, /^## Dependencies & Boundaries/mu);
    assert.match(successfulNoteContent, /^## Knowledge & Source of Truth/mu);
    assert.match(successfulNoteContent, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(successfulNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(successfulNoteContent, /^## Findings/mu);

    const failedNoteContent = readFileSync(failedNote.noteFilePath, "utf8");
    assert.match(failedNoteContent, new RegExp(`^# ${escapeRegExp(failedFile)}`, "u"));
    assert.match(failedNoteContent, /^## Overview/mu);
    assert.match(failedNoteContent, /^## Dependencies & Boundaries/mu);
    assert.match(failedNoteContent, /^## Knowledge & Source of Truth/mu);
    assert.doesNotMatch(failedNoteContent, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(failedNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(failedNoteContent, /^## Findings/mu);

    const laterNoteContent = readFileSync(laterNote.noteFilePath, "utf8");
    assert.match(laterNoteContent, new RegExp(`^# ${escapeRegExp(laterFile)}`, "u"));
    assert.match(laterNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(laterNoteContent, /^## Overview/mu);
    assert.doesNotMatch(laterNoteContent, /^## Dependencies & Boundaries/mu);
    assert.doesNotMatch(laterNoteContent, /^## Knowledge & Source of Truth/mu);
    assert.doesNotMatch(laterNoteContent, /^## Strategy & What-if Scenarios/mu);

    const skippedPath = path.join(
      outputBaseDir,
      "review",
      "feature-branch_03131430",
      "skipped.md"
    );
    assert.equal(readFileSync(skippedPath, "utf8"), "");
  } finally {
    fixture.cleanup();
  }
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

function detectStepId(
  systemMessage: string
):
  | "step1-overview"
  | "step2-dependencies-boundaries"
  | "step3-knowledge-source-of-truth"
  | "step4-strategy-what-if-scenarios" {
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

  throw new Error(`Unknown step system message: ${systemMessage}`);
}

function createFourStepJudgeBackedStepRunner(input: {
  observedDisconnects: string[];
  observedProfiles: unknown[];
  observedPrompts: Array<{ stepId: string; prompt: string }>;
  observedStepEvents: string[][];
}): StepRunner {
  return new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        input.observedProfiles.push(profile);
        const stepId = detectStepId(profile.systemMessage);

        return new SessionExecutor({
          async sendAndWait(options, timeoutMs) {
            const filePath = extractDiffPath(options.prompt);

            input.observedStepEvents.push([stepId, filePath]);
            input.observedPrompts.push({ stepId, prompt: options.prompt });

            assert.equal(timeoutMs, 300_000);

            return {
              data: {
                content:
                  stepId === "step1-overview"
                    ? buildOverviewResponse(filePath)
                    : stepId === "step2-dependencies-boundaries"
                      ? buildDependenciesResponse(filePath)
                      : stepId === "step3-knowledge-source-of-truth"
                        ? buildKnowledgeResponse(filePath)
                        : buildStrategyResponse(filePath)
              }
            };
          },
          async disconnect() {
            input.observedDisconnects.push("disconnect");
          }
        });
      }
    },
    judgeService: {
      async evaluate() {
        return { passed: true };
      }
    }
  });
}
