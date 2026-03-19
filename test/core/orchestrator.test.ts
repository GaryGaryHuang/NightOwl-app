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

test("ReviewOrchestrator executes Step 1 in filtered changed-file order and updates notes from bootstrap to Overview snapshots", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const observedProfiles = [];
    const observedStep1Files = [];
    const observedPrompts = [];
    const observedDisconnects = [];
    const sourceProvider = new LocalGitProvider();
    const stepRunner = createJudgeBackedStepRunner({
      observedDisconnects,
      observedProfiles,
      observedPrompts,
      observedStep1Files
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
    assert.deepEqual(observedStep1Files, reviewableFiles);
    assert.equal(observedDisconnects.length, reviewableFiles.length);
    assert.equal(observedProfiles.length, reviewableFiles.length);

    for (const profile of observedProfiles) {
      assert.equal(profile.model, "gpt-5-mini");
      assert.equal(profile.outputBaseDir, outputBaseDir);
      assert.equal(profile.repoRoot, repoRoot);
      assert.equal(profile.workingDirectory, repoRoot);
      assert.match(profile.systemMessage, /## Current Step: Overview/u);
    }

    assert.match(observedPrompts[0] ?? "", /## Changeset Overview/u);
    assert.doesNotMatch(observedPrompts[0] ?? "", /<current_review>/u);
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
      assert.doesNotMatch(noteContent, /Review not yet generated/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator still succeeds with zero planned files and does not create Step 1 sessions", async () => {
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
          async createSession() {
            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);
                const attempt = (reviewAttempts.get(filePath) ?? 0) + 1;

                reviewAttempts.set(filePath, attempt);

                return {
                  data: {
                    content: buildOverviewResponse(`${filePath} attempt ${attempt}`)
                  }
                };
              },
              async disconnect() {}
            });
          }
        },
        judgeService: {
          async evaluate(input) {
            const current = (judgeAttempts.get(input.filePath) ?? 0) + 1;

            judgeAttempts.set(input.filePath, current);

            if (current === 1) {
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
    }

    for (const filePath of reviewableFiles) {
      assert.equal(reviewAttempts.get(filePath), 2);
      assert.equal(judgeAttempts.get(filePath), 2);
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
            if (sessionCount === 1) {
              throw new Error("Copilot CLI session startup failed.");
            }

            sessionCount += 1;

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
        async run({ context }) {
          executedFiles.push(context.filePath);
          context.setSection("overview", buildOverviewResponse(context.filePath));

          return {
            stepId: "step1-overview",
            applyTo(targetContext) {
              targetContext.setSection(
                "overview",
                context.getSection("overview")
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
    assert.deepEqual(executedFiles, [reviewableFiles[0]]);

    const firstBootstrap = readFileSync(plannedNotes[0].noteFilePath, "utf8");
    assert.match(firstBootstrap, /^## Overview/mu);
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
    const executedFiles = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession() {
            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);

                executedFiles.push(filePath);

                if (filePath === successfulFile) {
                  return {
                    data: {
                      content: buildOverviewResponse(filePath)
                    }
                  };
                }

                if (filePath === failedFile) {
                  return input.failingBehavior();
                }

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
      input.expectedErrorPattern
    );

    assert.deepEqual(executedFiles, [successfulFile, failedFile, failedFile]);

    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === successfulFile
    );
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile);
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile);

    assert.ok(successfulNote);
    assert.ok(failedNote);
    assert.ok(laterNote);

    assert.match(readFileSync(successfulNote.noteFilePath, "utf8"), /^## Overview/mu);
    assert.doesNotMatch(
      readFileSync(successfulNote.noteFilePath, "utf8"),
      /Review not yet generated/u
    );

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
          async evaluate(inputJudge) {
            if (inputJudge.filePath === failedFile) {
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

    assert.match(readFileSync(successfulNote.noteFilePath, "utf8"), /^## Overview/mu);
    assert.match(readFileSync(failedNote.noteFilePath, "utf8"), /Review not yet generated/u);
    assert.doesNotMatch(readFileSync(failedNote.noteFilePath, "utf8"), /^## Overview/mu);
    assert.match(readFileSync(laterNote.noteFilePath, "utf8"), /Review not yet generated/u);
    assert.doesNotMatch(readFileSync(laterNote.noteFilePath, "utf8"), /^## Overview/mu);
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

function createJudgeBackedStepRunner(input: {
  observedDisconnects: string[];
  observedProfiles: unknown[];
  observedPrompts: string[];
  observedStep1Files: string[];
}): StepRunner {
  return new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        input.observedProfiles.push(profile);

        return new SessionExecutor({
          async sendAndWait(options, timeoutMs) {
            const filePath = extractDiffPath(options.prompt);

            input.observedStep1Files.push(filePath);
            input.observedPrompts.push(options.prompt);

            assert.equal(timeoutMs, 300_000);

            return {
              data: {
                content: buildOverviewResponse(filePath)
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
