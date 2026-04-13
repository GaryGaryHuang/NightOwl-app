import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import type { RunStepInput, StepResult } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { buildDependenciesResponse, buildKnowledgeResponse, buildOverviewResponse, buildStandardStep5JsonResponse, buildStandardStep6JsonResponse, buildStandardStep7SummaryResponse, buildStrategyResponse, detectStepId, extractDiffPath } from "../helpers/orchestrator-fixture.ts";
import { createStepResponseRouter } from "../helpers/orchestrator-step-contract-fixture.ts";

type StepEvent = [string, string];

test("ReviewOrchestrator does not start Step 3, Step 4, Step 5, Step 6, or Step 7 for a failed Step 2 file or any later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step2 gating");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const stepEvents: StepEvent[] = [];
    const reviewAttempts = new Map();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
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
      userContext: [],
      dryRun: false
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
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step1 gating");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
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
      userContext: [],
      dryRun: false
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
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step1 snapshot preservation");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const outputBaseDir = realpathSync(fixture.repoDir);
    const plannedNotes = planNoteFiles(
      path.join(outputBaseDir, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const successfulFile = reviewableFiles[0];
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
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
      userContext: [],
      dryRun: false
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

test("ReviewOrchestrator skips a file when getDiff fails and lets other files complete normally", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for getDiff failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const outputBaseDir = realpathSync(fixture.repoDir);
    const outputTarget = path.join(
      outputBaseDir,
      ".nightowl",
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
        }
      },
      reviewFileFilter,
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

          context.setFindings([
              {
                type: "must",
                title: "問題標題",
                traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
                context: "具體情境",
                deviation: "預期與實際有落差",
                impact: "會造成 correctness 問題",
                suggestion: "補上 guard",
                confidence: 88
              }
            ]);

          return {
            stepId: step.stepId,
            applyTo(targetContext: FileReviewContext) {
              targetContext.setFindings(context.getStructuredState().findings ?? []);
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

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    // The failed file should be skipped, other files should complete normally.
    assert.equal(result.successfulFileCount, reviewableFiles.length - 1);
    assert.equal(result.skippedFileCount, 1);

    // Steps should have run for all files except the failed one.
    assert.equal(
      executedSteps.filter(([, fp]) => fp === failedFile).length,
      0
    );

    // The first file should have a complete review with Findings.
    const firstNote = readFileSync(plannedNotes[0].noteFilePath, "utf8");
    assert.match(firstNote, /^## Findings/mu);
    assert.doesNotMatch(firstNote, /Review not yet generated/u);

    // The failed file should have an interrupted snapshot with diff-loading warning.
    const failedNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    assert.match(failedNote, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNote, /diff-loading/u);
    assert.match(failedNote, /git diff failed/u);

    // The skipped.md should reference diff-loading, not step1-overview.
    const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");
    assert.match(skippedLog, /diff-loading/u);
    assert.doesNotMatch(skippedLog, /step1-overview/u);
  } finally {
    fixture.cleanup();
  }
});

const buildStepResponse = createStepResponseRouter({
  step5Response: () => buildStandardStep5JsonResponse(),
  step6Response: () => buildStandardStep6JsonResponse(),
  step7Response: (fp) => buildStandardStep7SummaryResponse(fp)
});
