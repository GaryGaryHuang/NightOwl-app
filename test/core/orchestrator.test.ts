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
        assert.match(profile.systemMessage, /## Current Step: Dependencies & Boundaries/u);
        assert.equal(profile.model, "gpt-5.4-mini");
      } else if (/## Current Step: Knowledge & Source of Truth/u.test(profile.systemMessage)) {
        assert.match(profile.systemMessage, /## Current Step: Knowledge & Source of Truth/u);
        assert.equal(profile.model, "gpt-5-mini");
      } else {
        assert.match(profile.systemMessage, /## Current Step: Strategy & What-if Scenarios/u);
        assert.equal(profile.model, "gpt-5.4-mini");
      }
    }

    const step1Prompt = observedPrompts.find(({ stepId }) => stepId === "step1-overview");
    const step2Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step2-dependencies-boundaries"
    );
    const step3Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step3-knowledge-source-of-truth"
    );
    const step4Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step4-strategy-what-if-scenarios"
    );

    assert.match(step1Prompt?.prompt ?? "", /## Changeset Overview/u);
    assert.doesNotMatch(step1Prompt?.prompt ?? "", /<current_review>/u);
    assert.match(step2Prompt?.prompt ?? "", /<current_review>[\s\S]*## Overview/u);
    assert.doesNotMatch(step2Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.match(
      step3Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Dependencies & Boundaries/u
    );
    assert.match(
      step4Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Knowledge & Source of Truth/u
    );
    assert.doesNotMatch(step3Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.doesNotMatch(step4Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.filesPath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, new RegExp(`^# ${escapeRegExp(plannedNote.filePath)}`, "u"));
      assert.match(
        noteContent,
        new RegExp(`- Source file: \`${escapeRegExp(plannedNote.filePath)}\``, "u")
      );
      assert.match(noteContent, /^## Overview/mu);
      assert.match(noteContent, /^## Dependencies & Boundaries/mu);
      assert.match(noteContent, /^## Knowledge & Source of Truth/mu);
      assert.match(noteContent, /^## Strategy & What-if Scenarios/mu);
      assert.match(
        noteContent,
        /## Overview[\s\S]*## Dependencies & Boundaries[\s\S]*## Knowledge & Source of Truth[\s\S]*## Strategy & What-if Scenarios/u
      );
      assert.doesNotMatch(noteContent, /Review not yet generated/u);
      assert.doesNotMatch(noteContent, /^## Findings/mu);
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

test("ReviewOrchestrator does not start Step 3 for a failed Step 2 file or any later files", async () => {
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
                  return {
                    data: {
                      content: buildOverviewResponse(filePath)
                    }
                  };
                }

                if (
                  stepId === "step2-dependencies-boundaries" &&
                  filePath === failedFile
                ) {
                  return {
                    data: {
                      content: "   "
                    }
                  };
                }

                if (stepId === "step2-dependencies-boundaries") {
                  return {
                    data: {
                      content: buildDependenciesResponse(filePath)
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

    assert.deepEqual(observedStepEvents, [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step1-overview", failedFile],
      ["step2-dependencies-boundaries", failedFile],
      ["step2-dependencies-boundaries", failedFile]
    ]);
    assert.equal(
      reviewAttempts.get(`step3-knowledge-source-of-truth:${failedFile}`),
      undefined
    );
    assert.equal(
      reviewAttempts.get(`step4-strategy-what-if-scenarios:${failedFile}`),
      undefined
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 2 for a failed Step 1 file or any later files", async () => {
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
    const laterFile = reviewableFiles[2];
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

                observedStepEvents.push([stepId, filePath]);

                if (stepId === "step1-overview") {
                  const currentAttempt = (reviewAttempts.get(filePath) ?? 0) + 1;

                  reviewAttempts.set(filePath, currentAttempt);

                  if (filePath === failedFile) {
                    return {
                      data: {
                        content: "   "
                      }
                    };
                  }

                  return {
                    data: {
                      content: buildOverviewResponse(filePath)
                    }
                  };
                }

                return {
                  data: {
                    content: buildDependenciesResponse(filePath)
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
        `step1-overview.*${escapeRegExp(failedFile)}|${escapeRegExp(failedFile)}.*step1-overview`,
        "u"
      )
    );

    assert.deepEqual(observedStepEvents, [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step1-overview", failedFile],
      ["step1-overview", failedFile]
    ]);
    assert.equal(reviewAttempts.get(laterFile), undefined);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 2 after a blank response and publishes only the successful retry snapshot", async () => {
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
                  return {
                    data: {
                      content: buildOverviewResponse(filePath)
                    }
                  };
                }

                if (filePath === retryFile && attempt === 1) {
                  return {
                    data: {
                      content: "   "
                    }
                  };
                }

                return {
                  data: {
                    content:
                      stepId === "step2-dependencies-boundaries"
                        ? buildDependenciesResponse(filePath, `${filePath} attempt ${attempt}`)
                        : buildStepResponse(stepId, filePath)
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

    assert.equal(reviewAttempts.get(`step2-dependencies-boundaries:${retryFile}`), 2);
    assert.equal(judgeAttempts.get(`step2-dependencies-boundaries:${retryFile}`), 1);
    assert.match(retriedContent, /attempt 2/u);
    assert.doesNotMatch(retriedContent, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 2 after judge rejection and publishes only the successful retry snapshot", async () => {
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
                          ? buildDependenciesResponse(filePath, `${filePath} attempt ${attempt}`)
                          : buildStepResponse(stepId, filePath)
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
              input.stepId === "step2-dependencies-boundaries" &&
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

    assert.equal(reviewAttempts.get(`step2-dependencies-boundaries:${retryFile}`), 2);
    assert.equal(judgeAttempts.get(`step2-dependencies-boundaries:${retryFile}`), 2);
    assert.match(retriedContent, /attempt 2/u);
    assert.doesNotMatch(retriedContent, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 3 after a blank response and publishes only the successful retry snapshot", async () => {
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

                if (filePath === retryFile && attempt === 1) {
                  return { data: { content: "   " } };
                }

                return {
                  data: {
                    content:
                      stepId === "step3-knowledge-source-of-truth"
                        ? buildKnowledgeResponse(filePath, `${filePath} attempt ${attempt}`)
                        : buildStrategyResponse(filePath)
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

    assert.equal(reviewAttempts.get(`step3-knowledge-source-of-truth:${retryFile}`), 2);
    assert.equal(judgeAttempts.get(`step3-knowledge-source-of-truth:${retryFile}`), 1);
    assert.match(retriedContent, /attempt 2/u);
    assert.doesNotMatch(retriedContent, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 3 after judge rejection and publishes only the successful retry snapshot", async () => {
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
                            ? buildKnowledgeResponse(filePath, `${filePath} attempt ${attempt}`)
                            : buildStrategyResponse(filePath)
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
              input.stepId === "step3-knowledge-source-of-truth" &&
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

    assert.equal(reviewAttempts.get(`step3-knowledge-source-of-truth:${retryFile}`), 2);
    assert.equal(judgeAttempts.get(`step3-knowledge-source-of-truth:${retryFile}`), 2);
    assert.match(retriedContent, /attempt 2/u);
    assert.doesNotMatch(retriedContent, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 3 after review session startup failure retry exhaustion and preserves the Step 2 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step3 startup failure");

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
              /## Current Step: Knowledge & Source of Truth/u.test(profile.systemMessage) &&
              (sessionCount === 7 || sessionCount === 8)
            ) {
              throw new Error("review startup failed");
            }

            const stepId = detectStepId(profile.systemMessage);

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);

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
        `step3-knowledge-source-of-truth.*${escapeRegExp(failedFile)}.*review startup failed|${escapeRegExp(failedFile)}.*step3-knowledge-source-of-truth.*review startup failed`,
        "u"
      )
    );

    assert.equal(sessionCount, 8);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 3 after empty review response retry exhaustion and preserves the Step 2 snapshot", async () => {
  await assertStep3Failure({
    title: "step3 empty response",
    expectedErrorPattern:
      /step3-knowledge-source-of-truth.*empty review response|empty review response.*step3-knowledge-source-of-truth/u,
    step3ReviewFailure() {
      return { data: { content: "   " } };
    },
    expectedStep3JudgeAttempts: 0
  });
});

test("ReviewOrchestrator aborts Step 3 after review timeout retry exhaustion and preserves the Step 2 snapshot", async () => {
  await assertStep3Failure({
    title: "step3 review timeout",
    expectedErrorPattern:
      /step3-knowledge-source-of-truth.*review timeout|review timeout.*step3-knowledge-source-of-truth/u,
    step3ReviewFailure() {
      throw new Error("review timeout");
    },
    expectedStep3JudgeAttempts: 0
  });
});

test("ReviewOrchestrator aborts Step 3 after judge startup failure retry exhaustion and preserves the Step 2 snapshot", async () => {
  await assertStep3Failure({
    title: "step3 judge startup failure",
    expectedErrorPattern:
      /step3-knowledge-source-of-truth.*judge startup failed|judge startup failed.*step3-knowledge-source-of-truth/u,
    step3JudgeFailure() {
      throw new Error("judge startup failed");
    },
    expectedStep3JudgeAttempts: 2
  });
});

test("ReviewOrchestrator aborts Step 3 after judge timeout retry exhaustion and preserves the Step 2 snapshot", async () => {
  await assertStep3Failure({
    title: "step3 judge timeout",
    expectedErrorPattern:
      /step3-knowledge-source-of-truth.*judge timeout|judge timeout.*step3-knowledge-source-of-truth/u,
    step3JudgeFailure() {
      throw new Error("judge timeout");
    },
    expectedStep3JudgeAttempts: 2
  });
});

test("ReviewOrchestrator aborts Step 3 after judge rejection retry exhaustion and preserves the Step 2 snapshot", async () => {
  await assertStep3Failure({
    title: "step3 judge rejection",
    expectedErrorPattern:
      /step3-knowledge-source-of-truth.*judge rejected|judge rejected.*step3-knowledge-source-of-truth/u,
    step3JudgeFailure() {
      return { passed: false, cause: "judge rejected" };
    },
    expectedStep3JudgeAttempts: 2
  });
});

test("ReviewOrchestrator aborts Step 2 after review session startup failure retry exhaustion and preserves the Step 1 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step2 startup failure");

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
              /## Current Step: Dependencies & Boundaries/u.test(profile.systemMessage) &&
              (sessionCount === 6 || sessionCount === 7)
            ) {
              throw new Error("review startup failed");
            }

            const stepId = detectStepId(profile.systemMessage);

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);

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
        `step2-dependencies-boundaries.*${escapeRegExp(failedFile)}.*review startup failed|${escapeRegExp(failedFile)}.*step2-dependencies-boundaries.*review startup failed`,
        "u"
      )
    );

    assert.equal(sessionCount, 7);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 2 after empty review response retry exhaustion and preserves the Step 1 snapshot", async () => {
  await assertStep2Failure({
    title: "step2 empty response",
    expectedErrorPattern:
      /step2-dependencies-boundaries.*empty review response|empty review response.*step2-dependencies-boundaries/u,
    step2ReviewFailure() {
      return {
        data: {
          content: "   "
        }
      };
    },
    expectedStep2JudgeAttempts: 0
  });
});

test("ReviewOrchestrator aborts Step 2 after review timeout retry exhaustion and preserves the Step 1 snapshot", async () => {
  await assertStep2Failure({
    title: "step2 review timeout",
    expectedErrorPattern:
      /step2-dependencies-boundaries.*review timeout|review timeout.*step2-dependencies-boundaries/u,
    step2ReviewFailure() {
      throw new Error("review timeout");
    },
    expectedStep2JudgeAttempts: 0
  });
});

test("ReviewOrchestrator aborts Step 2 after judge startup failure retry exhaustion and preserves the Step 1 snapshot", async () => {
  await assertStep2Failure({
    title: "step2 judge startup failure",
    expectedErrorPattern:
      /step2-dependencies-boundaries.*judge startup failed|judge startup failed.*step2-dependencies-boundaries/u,
    step2JudgeFailure() {
      throw new Error("judge startup failed");
    },
    expectedStep2JudgeAttempts: 2
  });
});

test("ReviewOrchestrator aborts Step 2 after judge timeout retry exhaustion and preserves the Step 1 snapshot", async () => {
  await assertStep2Failure({
    title: "step2 judge timeout",
    expectedErrorPattern:
      /step2-dependencies-boundaries.*judge timeout|judge timeout.*step2-dependencies-boundaries/u,
    step2JudgeFailure() {
      throw new Error("judge timeout");
    },
    expectedStep2JudgeAttempts: 2
  });
});

test("ReviewOrchestrator aborts Step 2 after judge rejection retry exhaustion and preserves the Step 1 snapshot", async () => {
  await assertStep2Failure({
    title: "step2 judge rejection",
    expectedErrorPattern:
      /step2-dependencies-boundaries.*judge rejected|judge rejected.*step2-dependencies-boundaries/u,
    step2JudgeFailure() {
      return { passed: false, cause: "judge rejected" };
    },
    expectedStep2JudgeAttempts: 2
  });
});

test("ReviewOrchestrator aborts Step 1 flow on a blank response while preserving earlier successful snapshots", async () => {
  await assertStep1Failure({
    title: "blank response",
    failingBehavior() {
      return {
        data: {
          content: "   "
        }
      };
    },
    expectedErrorPattern:
      /step1-overview.*(?:README\.md|packages\/app\/index\.ts|src\/app\.ts)|(?:README\.md|packages\/app\/index\.ts|src\/app\.ts).*step1-overview/u
  });
});

test("ReviewOrchestrator retries Step 1 after judge rejection and publishes only the successful retry snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const reviewAttempts = new Map();
    const judgeAttempts = new Map();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
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
                        ? buildOverviewResponse(`${filePath} attempt ${attempt}`)
                        : buildStepResponse(stepId, filePath)
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
            const current = (judgeAttempts.get(key) ?? 0) + 1;

            judgeAttempts.set(key, current);

            if (input.stepId === "step1-overview" && current === 1) {
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

    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = new LocalGitProvider().filterIgnoredFiles(
      repoRoot,
      new LocalGitProvider().getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);

    for (const plannedNote of plannedNotes) {
      const noteContent = readFileSync(plannedNote.noteFilePath, "utf8");

      assert.match(noteContent, /attempt 2/u);
      assert.match(noteContent, /^## Dependencies & Boundaries/mu);
      assert.match(noteContent, /^## Strategy & What-if Scenarios/mu);
    }

    for (const filePath of reviewableFiles) {
      assert.equal(reviewAttempts.get(`step1-overview:${filePath}`), 2);
      assert.equal(judgeAttempts.get(`step1-overview:${filePath}`), 2);
      assert.equal(reviewAttempts.get(`step2-dependencies-boundaries:${filePath}`), 1);
      assert.equal(judgeAttempts.get(`step2-dependencies-boundaries:${filePath}`), 1);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 1 after judge rejection retry exhaustion and preserves bootstrap semantics", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for judge rejection failure");

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
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const judgeAttempts = new Map();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession() {
            return new SessionExecutor({
              async sendAndWait(options) {
                return {
                  data: {
                    content: buildOverviewResponse(extractDiffPath(options.prompt))
                  }
                };
              },
              async disconnect() {}
            });
          }
        },
        judgeService: {
          async evaluate(input) {
            judgeAttempts.set(
              input.filePath,
              (judgeAttempts.get(input.filePath) ?? 0) + 1
            );

            if (input.filePath === failedFile) {
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      new RegExp(
        `step1-overview.*${escapeRegExp(failedFile)}.*judge rejected|${escapeRegExp(failedFile)}.*step1-overview.*judge rejected`,
        "u"
      )
    );

    assert.equal(judgeAttempts.get(failedFile), 2);

    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === reviewableFiles[0]
    );
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile);
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile);

    assert.match(readFileSync(successfulNote.noteFilePath, "utf8"), /^## Overview/mu);
    assert.match(readFileSync(failedNote.noteFilePath, "utf8"), /Review not yet generated/u);
    assert.doesNotMatch(readFileSync(failedNote.noteFilePath, "utf8"), /^## Overview/mu);
    assert.match(readFileSync(laterNote.noteFilePath, "utf8"), /Review not yet generated/u);
    assert.doesNotMatch(readFileSync(laterNote.noteFilePath, "utf8"), /^## Overview/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts Step 1 flow on a timeout error while preserving earlier successful snapshots", async () => {
  await assertStep1Failure({
    title: "timeout",
    failingBehavior() {
      throw new Error("Step 1 timed out.");
    },
    expectedErrorPattern:
      /step1-overview.*timed out|timed out.*step1-overview/u
  });
});

test("ReviewOrchestrator aborts Step 1 after judge startup failure retry exhaustion and preserves bootstrap semantics", async () => {
  await assertJudgeFailure({
    title: "judge startup failure",
    expectedErrorPattern:
      /step1-overview.*judge startup failed|judge startup failed.*step1-overview/u,
    judgeFailure() {
      throw new Error("Step step1-overview failed for src/app.ts: judge startup failed");
    }
  });
});

test("ReviewOrchestrator aborts Step 1 after judge timeout retry exhaustion and preserves bootstrap semantics", async () => {
  await assertJudgeFailure({
    title: "judge timeout failure",
    expectedErrorPattern:
      /step1-overview.*judge timeout|judge timeout.*step1-overview/u,
    judgeFailure() {
      throw new Error("Step step1-overview failed for src/app.ts: judge timeout");
    }
  });
});

test("ReviewOrchestrator aborts Step 1 flow when Step 1 session startup fails", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file");

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
          async createSession() {
            if (sessionCount === 4) {
              throw new Error("Copilot CLI session startup failed.");
            }

            sessionCount += 1;

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);

                return {
                  data: {
                    content: buildOverviewResponse(filePath)
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
        `step1-overview.*${escapeRegExp(failedFile)}|${escapeRegExp(failedFile)}.*step1-overview`,
        "u"
      )
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator preserves already-published bootstrap notes when getDiff fails after output initialization", async () => {
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
    const laterFile = reviewableFiles[2];
    const executedFiles = [];
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
          executedFiles.push([step.stepId, context.filePath]);

          if (step.stepId === "step1-overview") {
            context.setSection("overview", buildOverviewResponse(context.filePath));

            return {
              stepId: "step1-overview",
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
              stepId: "step2-dependencies-boundaries",
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
              stepId: "step3-knowledge-source-of-truth",
              applyTo(targetContext) {
                targetContext.setSection(
                  "knowledge-source-of-truth",
                  context.getSection("knowledge-source-of-truth")
                );
              }
            };
          }

          context.setSection(
            "strategy-what-if-scenarios",
            buildStrategyResponse(context.filePath)
          );

          return {
            stepId: "step4-strategy-what-if-scenarios",
            applyTo(targetContext) {
              targetContext.setSection(
                "strategy-what-if-scenarios",
                context.getSection("strategy-what-if-scenarios")
              );
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

    assert.equal(existsSync(outputTarget), true);
    assert.deepEqual(executedFiles, [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]]
    ]);

    const firstBootstrap = readFileSync(plannedNotes[0].noteFilePath, "utf8");
    assert.match(firstBootstrap, /^## Overview/mu);
    assert.match(firstBootstrap, /^## Dependencies & Boundaries/mu);
    assert.match(firstBootstrap, /^## Knowledge & Source of Truth/mu);
    assert.match(firstBootstrap, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(firstBootstrap, /Review not yet generated/u);

    const failedBootstrap = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile).noteFilePath,
      "utf8"
    );
    assert.match(failedBootstrap, /Review not yet generated/u);
    assert.doesNotMatch(failedBootstrap, /^## Overview/mu);

    const laterBootstrap = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === laterFile).noteFilePath,
      "utf8"
    );
    assert.match(laterBootstrap, /Review not yet generated/u);
    assert.doesNotMatch(laterBootstrap, /^## Overview/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not initialize local output when Step 0 fails", async () => {
  const calls = [];
  const fixture = createReviewRepoFixture();

  try {
    const outputTarget = path.join(
      fixture.repoDir,
      "packages",
      "app",
      "review"
    );
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

async function assertStep1Failure(input: {
  title: string;
  failingBehavior(): { data?: { content?: string } } | never;
  expectedErrorPattern: RegExp;
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
    const outputTargetFilesPath = path.join(
      outputBaseDir,
      "review",
      "feature-branch_03131430",
      "files"
    );
    const plannedNotes = planNoteFiles(outputTargetFilesPath, reviewableFiles);
    const successfulFile = reviewableFiles[0];
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const executedEvents = [];
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

                executedEvents.push([stepId, filePath]);

                if (stepId === "step1-overview" && filePath === successfulFile) {
                  return {
                    data: {
                      content: buildOverviewResponse(filePath)
                    }
                  };
                }

                if (stepId === "step2-dependencies-boundaries" && filePath === successfulFile) {
                  return {
                    data: {
                      content: buildDependenciesResponse(filePath)
                    }
                  };
                }

                if (stepId === "step3-knowledge-source-of-truth" && filePath === successfulFile) {
                  return {
                    data: {
                      content: buildKnowledgeResponse(filePath)
                    }
                  };
                }

                if (stepId === "step1-overview" && filePath === failedFile) {
                  return input.failingBehavior();
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
      input.expectedErrorPattern
    );

    assert.deepEqual(executedEvents, [
      ["step1-overview", successfulFile],
      ["step2-dependencies-boundaries", successfulFile],
      ["step3-knowledge-source-of-truth", successfulFile],
      ["step4-strategy-what-if-scenarios", successfulFile],
      ["step1-overview", failedFile],
      ["step1-overview", failedFile]
    ]);

    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === successfulFile
    );
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile);
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile);

    assert.ok(successfulNote);
    assert.ok(failedNote);
    assert.ok(laterNote);

    const successfulNoteContent = readFileSync(successfulNote.noteFilePath, "utf8");
    assert.match(successfulNoteContent, /^## Overview/mu);
    assert.match(successfulNoteContent, /^## Dependencies & Boundaries/mu);
    assert.match(successfulNoteContent, /^## Knowledge & Source of Truth/mu);
    assert.match(successfulNoteContent, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(successfulNoteContent, /Review not yet generated/u);

    const failedNoteContent = readFileSync(failedNote.noteFilePath, "utf8");
    assert.match(
      failedNoteContent,
      new RegExp(`^# ${escapeRegExp(failedFile)}`, "u")
    );
    assert.match(failedNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(failedNoteContent, /^## Overview/mu);

    const laterNoteContent = readFileSync(laterNote.noteFilePath, "utf8");
    assert.match(
      laterNoteContent,
      new RegExp(`^# ${escapeRegExp(laterFile)}`, "u")
    );
    assert.match(laterNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(laterNoteContent, /^## Overview/mu);

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

async function assertJudgeFailure(input: {
  title: string;
  expectedErrorPattern: RegExp;
  judgeFailure(): never;
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
                return {
                  data: {
                    content:
                      stepId === "step1-overview"
                        ? buildOverviewResponse(extractDiffPath(options.prompt))
                        : stepId === "step2-dependencies-boundaries"
                          ? buildDependenciesResponse(extractDiffPath(options.prompt))
                          : buildStepResponse(stepId, extractDiffPath(options.prompt))
                  }
                };
              },
              async disconnect() {}
            });
          }
        },
        judgeService: {
          async evaluate(inputJudge) {
            if (
              inputJudge.stepId === "step1-overview" &&
              inputJudge.filePath === failedFile
            ) {
              return input.judgeFailure();
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

    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === reviewableFiles[0]
    );
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile);
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile);

    const successfulNoteContent = readFileSync(successfulNote.noteFilePath, "utf8");
    assert.match(successfulNoteContent, /^## Overview/mu);
    assert.match(successfulNoteContent, /^## Dependencies & Boundaries/mu);
    assert.match(successfulNoteContent, /^## Knowledge & Source of Truth/mu);
    assert.match(successfulNoteContent, /^## Strategy & What-if Scenarios/mu);
    assert.match(readFileSync(failedNote.noteFilePath, "utf8"), /Review not yet generated/u);
    assert.doesNotMatch(readFileSync(failedNote.noteFilePath, "utf8"), /^## Overview/mu);
    assert.match(readFileSync(laterNote.noteFilePath, "utf8"), /Review not yet generated/u);
    assert.doesNotMatch(readFileSync(laterNote.noteFilePath, "utf8"), /^## Overview/mu);
  } finally {
    fixture.cleanup();
  }
}

async function assertStep2Failure(input: {
  title: string;
  expectedErrorPattern: RegExp;
  step2ReviewFailure?: () => { data?: { content?: string } } | never;
  step2JudgeFailure?: () => { passed: boolean; cause?: string } | never;
  expectedStep2JudgeAttempts: number;
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
                  return {
                    data: {
                      content: buildOverviewResponse(filePath)
                    }
                  };
                }

                if (filePath === failedFile && input.step2ReviewFailure) {
                  return input.step2ReviewFailure();
                }

                return {
                  data: {
                    content:
                      stepId === "step2-dependencies-boundaries"
                        ? buildDependenciesResponse(filePath)
                        : buildStepResponse(stepId, filePath)
                  }
                };
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
              inputJudge.stepId === "step2-dependencies-boundaries" &&
              inputJudge.filePath === failedFile &&
              input.step2JudgeFailure
            ) {
              return input.step2JudgeFailure();
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

    assert.equal(reviewAttempts.get(`step2-dependencies-boundaries:${failedFile}`), 2);
    assert.equal(
      judgeAttempts.get(`step2-dependencies-boundaries:${failedFile}`) ?? 0,
      input.expectedStep2JudgeAttempts
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

    const failedNoteContent = readFileSync(failedNote.noteFilePath, "utf8");
    assert.match(
      failedNoteContent,
      new RegExp(`^# ${escapeRegExp(failedFile)}`, "u")
    );
    assert.match(failedNoteContent, /^## Overview/mu);
    assert.doesNotMatch(failedNoteContent, /^## Dependencies & Boundaries/mu);
    assert.doesNotMatch(failedNoteContent, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(failedNoteContent, /Review not yet generated/u);

    const laterNoteContent = readFileSync(laterNote.noteFilePath, "utf8");
    assert.match(
      laterNoteContent,
      new RegExp(`^# ${escapeRegExp(laterFile)}`, "u")
    );
    assert.match(laterNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(laterNoteContent, /^## Overview/mu);
    assert.doesNotMatch(laterNoteContent, /^## Dependencies & Boundaries/mu);
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

async function assertStep3Failure(input: {
  title: string;
  expectedErrorPattern: RegExp;
  step3ReviewFailure?: () => { data?: { content?: string } } | never;
  step3JudgeFailure?: () => { passed: boolean; cause?: string } | never;
  expectedStep3JudgeAttempts: number;
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

                if (filePath === failedFile && input.step3ReviewFailure) {
                  return input.step3ReviewFailure();
                }

                return { data: { content: buildStepResponse(stepId, filePath) } };
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
              inputJudge.stepId === "step3-knowledge-source-of-truth" &&
              inputJudge.filePath === failedFile &&
              input.step3JudgeFailure
            ) {
              return input.step3JudgeFailure();
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

    assert.equal(reviewAttempts.get(`step3-knowledge-source-of-truth:${failedFile}`), 2);
    assert.equal(
      judgeAttempts.get(`step3-knowledge-source-of-truth:${failedFile}`) ?? 0,
      input.expectedStep3JudgeAttempts
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

    const failedNoteContent = readFileSync(failedNote.noteFilePath, "utf8");
    assert.match(
      failedNoteContent,
      new RegExp(`^# ${escapeRegExp(failedFile)}`, "u")
    );
    assert.match(failedNoteContent, /^## Overview/mu);
    assert.match(failedNoteContent, /^## Dependencies & Boundaries/mu);
    assert.doesNotMatch(failedNoteContent, /^## Knowledge & Source of Truth/mu);
    assert.doesNotMatch(failedNoteContent, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(failedNoteContent, /Review not yet generated/u);

    const laterNoteContent = readFileSync(laterNote.noteFilePath, "utf8");
    assert.match(
      laterNoteContent,
      new RegExp(`^# ${escapeRegExp(laterFile)}`, "u")
    );
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

function buildDependenciesResponse(filePath: string, label = filePath): string {
  return [
    "## Dependencies & Boundaries",
    "- 相依清單：",
    `  - \`[${label}:valueService]\` → 提供 value 更新 → Consume`,
    "    - Contract：輸入 value 並回傳更新結果",
    "    - 評估：此 diff 維持既有 boundary",
    "- 隱含相依：",
    "  - 無"
  ].join("\n");
}

function buildKnowledgeResponse(filePath: string, label = filePath): string {
  return [
    "## Knowledge & Source of Truth",
    "- 版本／文件參考：",
    `  - ${label} package.json — repo-native source`,
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

function buildStepResponse(
  stepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step3-knowledge-source-of-truth"
    | "step4-strategy-what-if-scenarios",
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

  return buildStrategyResponse(filePath);
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
                content: buildStepResponse(stepId, filePath)
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
