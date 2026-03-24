import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import type { OutputTarget } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import type { RunStepInput, StepResult } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import type { ReviewOutputSink } from "../../src/providers/review-output-sink.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

type StepEvent = [string, string];
type OutputCall = [string, string];

test("ReviewOrchestrator does not start Step 3, Step 4, Step 5, Step 6, or Step 7 for a failed Step 2 file or any later files", async () => {
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
    const stepEvents: StepEvent[] = [];
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(result.plannedFileCount, reviewableFiles.length);

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
    assert.equal(
      reviewAttempts.get(`step7-summary:${failedFile}`),
      undefined
    );
    assert.deepEqual(stepEvents.slice(0, 10), [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step5-validation-interrogation", reviewableFiles[0]],
      ["step6-cognitive-simulation", reviewableFiles[0]],
      ["step7-summary", reviewableFiles[0]],
      ["step1-overview", failedFile],
      ["step2-dependencies-boundaries", failedFile],
      ["step2-dependencies-boundaries", failedFile]
    ]);

    const failedNote = readFileSync(
      planNoteFiles(result.outputTarget.filesPath, reviewableFiles).find(
        ({ filePath }) => filePath === failedFile
      )!.noteFilePath,
      "utf8"
    );
    const laterNote = readFileSync(
      planNoteFiles(result.outputTarget.filesPath, reviewableFiles).find(
        ({ filePath }) => filePath === reviewableFiles[2]
      )!.noteFilePath,
      "utf8"
    );

    assert.match(failedNote, /step2-dependencies-boundaries/u);
    assert.match(laterNote, /^## Summary/mu);
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
    const stepEvents: StepEvent[] = [];
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(result.plannedFileCount, reviewableFiles.length);

    assert.deepEqual(stepEvents.slice(0, 9), [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step5-validation-interrogation", reviewableFiles[0]],
      ["step6-cognitive-simulation", reviewableFiles[0]],
      ["step7-summary", reviewableFiles[0]],
      ["step1-overview", failedFile],
      ["step1-overview", failedFile]
    ]);

    const failedNote = readFileSync(
      planNoteFiles(result.outputTarget.filesPath, reviewableFiles).find(
        ({ filePath }) => filePath === failedFile
      )!.noteFilePath,
      "utf8"
    );
    const laterNote = readFileSync(
      planNoteFiles(result.outputTarget.filesPath, reviewableFiles).find(
        ({ filePath }) => filePath === reviewableFiles[2]
      )!.noteFilePath,
      "utf8"
    );
    assert.match(failedNote, /step1-overview/u);
    assert.match(laterNote, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator preserves a full successful Step 7 snapshot when a later file fails at Step 1", async () => {
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(result.plannedFileCount, reviewableFiles.length);

    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === successfulFile
    )!;
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile)!;

    const successfulNoteContent = readFileSync(successfulNote.noteFilePath, "utf8");
    assert.match(successfulNoteContent, /^## Findings/mu);
    assert.doesNotMatch(successfulNoteContent, /Review not yet generated/u);

    const failedNoteContent = readFileSync(failedNote.noteFilePath, "utf8");
    assert.match(failedNoteContent, /Review not yet generated/u);
    assert.doesNotMatch(failedNoteContent, /^## Overview/mu);

    const laterNoteContent = readFileSync(laterNote.noteFilePath, "utf8");
    assert.match(laterNoteContent, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator preserves an already-published full Step 7 snapshot when getDiff fails after output initialization", async () => {
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
    const executedSteps: Array<[string, string]> = [];
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
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          executedSteps.push([step.stepId, context.filePath]);

          if (step.stepId === "step1-overview") {
            context.setSection("overview", buildOverviewResponse(context.filePath));

            return {
              stepId: step.stepId,
              applyTo(targetContext: FileReviewContext) {
                targetContext.setSection("overview", context.getSection("overview")!);
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
              applyTo(targetContext: FileReviewContext) {
                targetContext.setSection(
                  "dependencies-boundaries",
                  context.getSection("dependencies-boundaries")!
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
              applyTo(targetContext: FileReviewContext) {
                targetContext.setSection(
                  "knowledge-source-of-truth",
                  context.getSection("knowledge-source-of-truth")!
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
              applyTo(targetContext: FileReviewContext) {
                targetContext.setSection(
                  "strategy-what-if-scenarios",
                  context.getSection("strategy-what-if-scenarios")!
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
            applyTo(targetContext: FileReviewContext) {
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
      ["step6-cognitive-simulation", reviewableFiles[0]],
      ["step7-summary", reviewableFiles[0]]
    ]);

    const firstNote = readFileSync(plannedNotes[0].noteFilePath, "utf8");
    assert.match(firstNote, /^## Findings/mu);
    assert.doesNotMatch(firstNote, /Review not yet generated/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when initializeRun fails before any bootstrap note publish or step execution", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for initializeRun failure");

    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          throw new Error("initialize failed");
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);
          throw new Error("should not start steps");
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
      /initialize failed/u
    );

    assert.deepEqual(outputCalls, [["initializeRun", path.join(
      fixture.repoDir,
      "packages",
      "app",
      "review",
      "feature-branch_03131430"
    )]]);
    assert.deepEqual(stepEvents, []);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when bootstrap note publication fails, preserves earlier bootstrap notes, and stops the bootstrap loop before Step 1", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for bootstrap publish failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const outputCalls: OutputCall[] = [];
    const writtenNotes = new Map<string, string>();
    const stepEvents: StepEvent[] = [];
    const failedNotePath = plannedNotes[1].noteFilePath;
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (fileResult.noteFilePath === failedNotePath) {
            throw new Error("note write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        assessSuccessfulSnapshotFailure() {
          return { faultScope: "single-file-output-fault" };
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);
          throw new Error(`should not start ${step.stepId}`);
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
      /note write failed/u
    );

    assert.deepEqual(stepEvents, []);
    assert.deepEqual(
      outputCalls.filter(([callType]) => callType === "publishFileReview"),
      [
        ["publishFileReview", plannedNotes[0].noteFilePath],
        ["publishFileReview", plannedNotes[1].noteFilePath]
      ]
    );
    assert.match(
      writtenNotes.get(plannedNotes[0].noteFilePath) ?? "",
      /Review not yet generated/u
    );
    assert.equal(writtenNotes.has(plannedNotes[1].noteFilePath), false);
    assert.equal(writtenNotes.has(plannedNotes[2].noteFilePath), false);
    assert.equal(
      outputCalls.some(([callType]) => callType === "publishSkippedFile"),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator downgrades a file to skipped when a successful step snapshot write fails and later files can continue", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for successful snapshot skip downgrade");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const laterNotePath = plannedNotes.find(
      ({ filePath }) => filePath === laterFile
    )!.noteFilePath;
    const stepEvents: StepEvent[] = [];
    const outputCalls: OutputCall[] = [];
    const writtenNotes = new Map<string, string>();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        assessSuccessfulSnapshotFailure() {
          return { faultScope: "single-file-output-fault" };
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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

    assert.equal(result.skippedFileCount, 1);
    assert.ok(
      stepEvents.some(([, filePath]) => filePath === laterFile)
    );
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
    assert.match(
      writtenNotes.get(laterNotePath) ?? "",
      /^# [\s\S]*^## Summary/mu
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when a successful snapshot write is classified as a shared output target fault and later files do not continue", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for shared-target successful snapshot failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const writtenNotes = new Map<string, string>();
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("disk full");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        assessSuccessfulSnapshotFailure() {
          return { faultScope: "shared-output-target-fault" };
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
      /disk full/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.equal(
      outputCalls.some(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      false
    );
    assert.equal(
      writtenNotes.get(failedNotePath)?.includes("Review Interrupted") ?? false,
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts conservatively when successful snapshot assessment fails", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for failed successful snapshot assessment");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }
        },
        assessSuccessfulSnapshotFailure() {
          throw new Error("classification unavailable");
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
      /note write failed/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.equal(
      outputCalls.some(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator reuses interrupted snapshot fatal handling when a single-file successful snapshot downgrade later fails to publish the interrupted snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for successful snapshot downgrade interrupted publish failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const writtenNotes = new Map<string, string>();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          if (
            fileResult.noteFilePath === failedNotePath &&
            /> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("interrupted snapshot write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        assessSuccessfulSnapshotFailure() {
          return { faultScope: "single-file-output-fault" };
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
      /interrupted snapshot write failed/u
    );

    assert.equal(
      outputCalls.some(([callType]) => callType === "publishSkippedFile"),
      false
    );
    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.doesNotMatch(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator reuses skipped-record fatal handling when a single-file successful snapshot downgrade later fails to append skipped.md", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for successful snapshot downgrade skipped publish failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const writtenNotes = new Map<string, string>();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
          writtenNotes.set(fileResult.noteFilePath, fileResult.content);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }
        },
        assessSuccessfulSnapshotFailure() {
          return { faultScope: "single-file-output-fault" };
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);

          if (skipRecord.filePath === failedFile) {
            throw new Error("skipped log write failed");
          }
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
      /skipped log write failed/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator preserves earlier successful file snapshots when a later successful snapshot write downgrades that file to skipped", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for later successful snapshot failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const firstNotePath = plannedNotes[0].noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        assessSuccessfulSnapshotFailure() {
          return { faultScope: "single-file-output-fault" };
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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

    assert.equal(result.skippedFileCount, 1);
    assert.match(writtenNotes.get(firstNotePath) ?? "", /^# [\s\S]*^## Summary/mu);
    assert.match(writtenNotes.get(failedNotePath) ?? "", /> \[!WARNING\] Review Interrupted/u);
    assert.match(writtenNotes.get(failedNotePath) ?? "", /^# [\s\S]*^## Overview/mu);
    assert.deepEqual(stepEvents.slice(0, 8), [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step5-validation-interrogation", reviewableFiles[0]],
      ["step6-cognitive-simulation", reviewableFiles[0]],
      ["step7-summary", reviewableFiles[0]],
      ["step1-overview", failedFile]
    ]);
    assert.ok(stepEvents.some(([, filePath]) => filePath === laterFile));
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator fails the run when applyTo throws and does not downgrade the file to skipped", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const stepEvents: StepEvent[] = [];
    const outputCalls: OutputCall[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);

          if (step.stepId !== "step1-overview") {
            throw new Error(`should not reach ${step.stepId}`);
          }

          return {
            stepId: step.stepId,
            applyTo() {
              throw new Error("apply failed");
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
      /apply failed/u
    );

    assert.deepEqual(stepEvents, [["step1-overview", reviewableFiles[0]]]);
    assert.equal(
      outputCalls.some(([callType]) => callType === "publishSkippedFile"),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts with the output error when interrupted snapshot publication fails and does not append a skipped record", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for interrupted snapshot publish failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: createStepFailureRunner({
        stepEvents,
        failedFile,
        failedStepId: "step5-validation-interrogation",
        failureCause: "deterministic validation failed"
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
      /note write failed/u
    );

    assert.equal(
      outputCalls.some(([callType]) => callType === "publishSkippedFile"),
      false
    );
    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /^# [\s\S]*^## Strategy & What-if Scenarios/mu
    );
    assert.doesNotMatch(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts with the output error when publishSkippedFile fails after the interrupted snapshot is written", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for skipped log publish failure");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(
        fixture.repoDir,
        "packages",
        "app",
        "review",
        "feature-branch_03131430",
        "files"
      ),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);

          if (skipRecord.filePath === failedFile) {
            throw new Error("skipped log write failed");
          }
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: createStepFailureRunner({
        stepEvents,
        failedFile,
        failedStepId: "step7-summary",
        failureCause: "judge rejected"
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
      /skipped log write failed/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not initialize local output when Step 0 fails", async () => {
  const calls: string[] = [];
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
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
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

// ---------------------------------------------------------------------------
// Task 5.2: onOutputTargetReady callback (orchestrator wiring)
// ---------------------------------------------------------------------------

test("ReviewOrchestrator invokes onOutputTargetReady callback after initializeRun() and before per-file workers begin", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const callOrder: string[] = [];
    let callbackOutputTarget: OutputTarget | undefined;

    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: {
        initializeRun(outputTarget) {
          callOrder.push("initializeRun");
          callbackOutputTarget = outputTarget;
        },
        publishFileReview() {
          callOrder.push("publishFileReview");
        },
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      },
      stepRunner: {
        async run(input) {
          callOrder.push("stepRunner.run");
          return { stepId: input.step.stepId, applyTo() {} };
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({ changesetOverview: "overview", userContext: [] });
        }
      },
      onOutputTargetReady: (outputTarget) => {
        callOrder.push("onOutputTargetReady");
        assert.ok(
          callOrder.includes("initializeRun"),
          "onOutputTargetReady must be called after initializeRun"
        );
        assert.equal(
          callOrder.filter((c) => c === "stepRunner.run").length,
          0,
          "onOutputTargetReady must be called before any per-file step"
        );
        assert.equal(outputTarget, callbackOutputTarget);
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      userContext: []
    });

    assert.ok(callOrder.includes("onOutputTargetReady"), "callback should have been invoked");
    const initIdx = callOrder.indexOf("initializeRun");
    const cbIdx = callOrder.indexOf("onOutputTargetReady");

    assert.ok(initIdx < cbIdx, "initializeRun must precede onOutputTargetReady");
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator works normally when onOutputTargetReady callback is not provided", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: {
        async run(input) {
          return { stepId: input.step.stepId, applyTo() {} };
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({ changesetOverview: "overview", userContext: [] });
        }
      },
      // onOutputTargetReady deliberately omitted
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    // Should not throw
    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      userContext: []
    });

    assert.ok(result.outputTarget !== undefined);
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

function buildStep7SummaryResponse(filePath: string): string {
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

  return buildStep7SummaryResponse(filePath);
}

function detectStepId(
  systemMessage: string
):
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

  if (/## Current Step: Summary/u.test(systemMessage)) {
    return "step7-summary";
  }

  throw new Error(`Unknown step system message: ${systemMessage}`);
}

function extractDiffPath(prompt: string): string {
  const match = prompt.match(/<diff path="([^"]+)"/u);

  if (match) {
    return match[1];
  }

  const sourceMatch = prompt.match(/- Source file: `([^`]+)`/u);

  if (sourceMatch) {
    return sourceMatch[1];
  }

  throw new Error(`Missing diff path in prompt: ${prompt}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createAlwaysSuccessfulStepRunner(
  stepEvents: StepEvent[]
): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      stepEvents.push([step.stepId, context.filePath]);

      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}

function createStepFailureRunner(input: {
  stepEvents: StepEvent[];
  failedFile: string;
  failedStepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step3-knowledge-source-of-truth"
    | "step4-strategy-what-if-scenarios"
    | "step5-validation-interrogation"
    | "step6-cognitive-simulation"
    | "step7-summary";
  failureCause:
    | "judge rejected"
    | "judge timeout"
    | "deterministic validation failed";
}): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      input.stepEvents.push([step.stepId, context.filePath]);

      if (
        context.filePath === input.failedFile &&
        step.stepId === input.failedStepId
      ) {
        throw new Error(
          `Step ${step.stepId} failed for ${context.filePath}: ${input.failureCause}`
        );
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}

function buildSuccessfulStepResult(
  stepId: string,
  filePath: string
): StepResult {
  if (stepId === "step1-overview") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection("overview", buildOverviewResponse(filePath));
      }
    };
  }

  if (stepId === "step2-dependencies-boundaries") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "dependencies-boundaries",
          buildDependenciesResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step3-knowledge-source-of-truth") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "knowledge-source-of-truth",
          buildKnowledgeResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step4-strategy-what-if-scenarios") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "strategy-what-if-scenarios",
          buildStrategyResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step5-validation-interrogation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.updateStructuredState({
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
    };
  }

  if (stepId === "step6-cognitive-simulation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.updateStructuredState({
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
    };
  }

  return {
    stepId,
    applyTo(targetContext: FileReviewContext) {
      targetContext.setSection("summary", buildStep7SummaryResponse(filePath));
    }
  };
}
