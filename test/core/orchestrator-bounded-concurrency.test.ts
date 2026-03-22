import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { Finding, FileReviewContext } from "../../src/core/file-review-context.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("ReviewOrchestrator uses bounded concurrency, finishes bootstrap before fan-out, and keeps summary/index in planned order despite out-of-order completion", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for bounded concurrency ordering");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const skippedFile = reviewableFiles.find((filePath) => filePath === "README.md");
    const fastSuccessfulFile = reviewableFiles.find(
      (filePath) => filePath === "packages/app/index.ts"
    );
    const slowSuccessfulFile = reviewableFiles.find(
      (filePath) => filePath === "src/app.ts"
    );
    const mediumSuccessfulFile = reviewableFiles.find(
      (filePath) =>
        filePath !== skippedFile &&
        filePath !== fastSuccessfulFile &&
        filePath !== slowSuccessfulFile
    );

    assert.ok(skippedFile);
    assert.ok(fastSuccessfulFile);
    assert.ok(slowSuccessfulFile);

    const metrics = createConcurrencyMetrics(reviewableFiles.length);
    const outputSink = new BootstrapTrackingOutputSink(metrics);
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createConcurrentRunner({
        metrics,
        getBootstrapPublishCount: () => outputSink.bootstrapPublishCount,
        completionDelayByFile: new Map([
          [fastSuccessfulFile, 0],
          [skippedFile, 5],
          [mediumSuccessfulFile ?? slowSuccessfulFile, 35],
          [slowSuccessfulFile, 60]
        ]),
        failedFile: skippedFile,
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
      timestampProvider: () => "03131430",
      maxConcurrentFiles: reviewableFiles.length
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const expectedIndexFileNoteLines = plannedNotes.map(
      (plannedNote) =>
        `- [\`${plannedNote.filePath}\`](./${path.relative(result.outputTarget.basePath, plannedNote.noteFilePath).replace(/\\/gu, "/")})`
    );

    assert.equal(metrics.firstStepBootstrapCount, reviewableFiles.length);
    assert.equal(outputSink.bootstrapPublishCount, reviewableFiles.length);
    assert.ok(metrics.maxActiveFiles > 1);
    assert.notDeepEqual(metrics.completionOrder, reviewableFiles);
    assert.ok(
      metrics.completionOrder.indexOf(fastSuccessfulFile) <
        metrics.completionOrder.indexOf(slowSuccessfulFile)
    );
    const successfulFilesInPlannedOrder = reviewableFiles.filter(
      (filePath) => filePath !== skippedFile
    );

    assertSuccessfulFileOrder(summaryContent, successfulFilesInPlannedOrder);
    assert.match(
      summaryContent,
      new RegExp(
        `## Skipped Files\\n- \`${escapeRegExp(skippedFile)}\` — step5-validation-interrogation — deterministic validation failed`,
        "u"
      )
    );
    assert.equal(
      indexContent,
      [
        "# Review Index",
        "",
        `- Repo root: \`${repoRoot}\``,
        "- Base ref: `main`",
        "- Head ref: `feature-branch`",
        `- Planned files: ${reviewableFiles.length}`,
        `- Successful files: ${reviewableFiles.length - 1}`,
        "- Skipped files: 1",
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)",
        "- [skipped.md](./skipped.md)",
        "",
        "## File Notes",
        ...expectedIndexFileNoteLines
      ].join("\n")
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator keeps an all-skipped run as a completed run under bounded concurrency and writes intact skipped.md records", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for all-skipped bounded concurrency");

    const sourceProvider = new LocalGitProvider();
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      sourceProvider.resolveRepoRoot(fixture.appDir),
      sourceProvider.getChangedFiles(sourceProvider.resolveRepoRoot(fixture.appDir), "main", "feature-branch")
    );
    const metrics = createConcurrencyMetrics(reviewableFiles.length);
    const outputSink = new LocalWorkspaceProvider();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createConcurrentRunner({
        metrics,
        getBootstrapPublishCount: () => reviewableFiles.length,
        completionDelayByFile: new Map(
          reviewableFiles.map((filePath, index) => [filePath, index * 5])
        ),
        failedFiles: new Set(reviewableFiles),
        failedStepId: "step1-overview",
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
      timestampProvider: () => "03131430",
      maxConcurrentFiles: 2
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

    assert.equal(metrics.maxActiveFiles, 2);
    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.equal(result.successfulFileCount, 0);
    assert.equal(result.skippedFileCount, reviewableFiles.length);
    assert.equal(existsSync(result.outputTarget.summaryPath), true);
    assert.equal(existsSync(result.outputTarget.indexPath), true);

    for (const filePath of reviewableFiles) {
      assert.match(
        skippedLog,
        new RegExp(`- \`${escapeRegExp(filePath)}\` — step1-overview — judge rejected`, "u")
      );
    }

    assert.doesNotMatch(skippedLog, /step1-overview.*step1-overview.*judge rejected.*judge rejected.*`/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator downgrades a file to skipped after a concurrent successful snapshot write failure and later files continue", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add enough changed files for concurrent single-file output fault");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const outputBaseDir = path.join(fixture.repoDir, "packages", "app");
    const plannedNotes = planNoteFiles(
      path.join(outputBaseDir, "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedFile = reviewableFiles[0];
    const siblingFile = reviewableFiles[1];
    const laterFiles = reviewableFiles.slice(2);
    const failedNotePath = plannedNotes.find(
      (plannedNote) => plannedNote.filePath === failedFile
    )!.noteFilePath;
    const writtenNotes = new Map<string, string>();
    const stepEvents: Array<[string, string]> = [];
    const outputSink = new SingleFileSnapshotFailingOutputSink({
      failedNotePath
    });
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createConcurrentRunner({
        metrics: createConcurrencyMetrics(reviewableFiles.length),
        getBootstrapPublishCount: () => reviewableFiles.length,
        completionDelayByFile: new Map([[siblingFile, 60]]),
        stepEvents
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
      timestampProvider: () => "03131430",
      maxConcurrentFiles: 2
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(result.skippedFileCount, 1);
    assert.ok(stepEvents.some(([, filePath]) => filePath === siblingFile));
    for (const laterFile of laterFiles) {
      assert.ok(stepEvents.some(([, filePath]) => filePath === laterFile));
    }
    const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

    assert.match(
      skippedLog,
      new RegExp(`- \`${escapeRegExp(failedFile)}\` — step1-overview — file review write failed`, "u")
    );
    assert.match(
      readFileSync(failedNotePath, "utf8"),
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator suppresses sibling successful snapshots and later dispatch after a shared-target successful snapshot failure", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add files for shared-target successful snapshot abort coordination");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[0];
    const siblingFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const outputBaseDir = path.join(fixture.repoDir, "packages", "app");
    const plannedNotes = planNoteFiles(
      path.join(outputBaseDir, "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      (plannedNote) => plannedNote.filePath === failedFile
    )!.noteFilePath;
    const siblingReleased = createDeferred<void>();
    const stepEvents: Array<[string, string]> = [];
    const outputSink = new SharedTargetSnapshotFailingOutputSink({
      failedNotePath,
      failedFile,
      onFailedSuccessfulSnapshotPublish() {
        siblingReleased.resolve();
      }
    });
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createSharedAbortRunner({
        stepEvents,
        gateByFileAndStep: new Map([[`${siblingFile}:step1-overview`, siblingReleased.promise]])
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
      timestampProvider: () => "03131430",
      maxConcurrentFiles: 2
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

    assert.deepEqual(
      stepEvents.filter(([, filePath]) => filePath === siblingFile),
      [["step1-overview", siblingFile]]
    );
    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.equal(outputSink.siblingSuccessfulSnapshotCount, 0);
    assert.equal(outputSink.siblingSkippedRecordCount, 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator suppresses later interrupted snapshots and skipped records after shared abort from skipped-artifact failure", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add files for skipped artifact abort coordination");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[0];
    const siblingFile = reviewableFiles[1];
    const stepEvents: Array<[string, string]> = [];
    const siblingFailureReleased = createDeferred<void>();
    const outputSink = new SkippedArtifactAbortOutputSink({
      failedSkippedFile: failedFile,
      onFailedSkippedPublish() {
        siblingFailureReleased.resolve();
      }
    });
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createSharedAbortRunner({
        stepEvents,
        failByFileAndStep: new Map([
          [`${failedFile}:step1-overview`, "judge rejected"],
          [`${siblingFile}:step1-overview`, "judge rejected"]
        ]),
        gateByFileAndStep: new Map([[`${siblingFile}:step1-overview`, siblingFailureReleased.promise]])
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
      timestampProvider: () => "03131430",
      maxConcurrentFiles: 2
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

    assert.deepEqual(
      stepEvents.filter(([, filePath]) => filePath === siblingFile),
      [["step1-overview", siblingFile]]
    );
    assert.equal(outputSink.siblingInterruptedSnapshotCount, 0);
    assert.equal(outputSink.siblingSkippedRecordCount, 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator still fails the run without returning a completed result when summary publishing fails after concurrent file processing", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for fatal bounded concurrency summary failure");

    const sourceProvider = new LocalGitProvider();
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      sourceProvider.resolveRepoRoot(fixture.appDir),
      sourceProvider.getChangedFiles(sourceProvider.resolveRepoRoot(fixture.appDir), "main", "feature-branch")
    );
    const metrics = createConcurrencyMetrics(reviewableFiles.length);
    const outputSink = new SummaryFailingOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createConcurrentRunner({
        metrics,
        getBootstrapPublishCount: () => reviewableFiles.length,
        completionDelayByFile: new Map([
          [reviewableFiles[0], 40],
          [reviewableFiles[1], 0],
          [reviewableFiles[2], 10]
        ])
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
      timestampProvider: () => "03131430",
      maxConcurrentFiles: 2
    });

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
        }),
      /summary write failed/u
    );

    assert.equal(metrics.maxActiveFiles, 2);
    assert.equal(outputSink.publishRunSummaryCalls, 1);
    assert.equal(existsSync(outputSink.summaryPath ?? ""), false);
    assert.ok(outputSink.writtenFileReviews.length > 0);
  } finally {
    fixture.cleanup();
  }
});

function createConcurrencyMetrics(expectedBootstrapCount: number) {
  return {
    expectedBootstrapCount,
    maxActiveFiles: 0,
    firstStepBootstrapCount: -1,
    completionOrder: [] as string[]
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

function createConcurrentRunner(input: {
  metrics: ReturnType<typeof createConcurrencyMetrics>;
  getBootstrapPublishCount: () => number;
  completionDelayByFile: Map<string, number>;
  stepEvents?: Array<[string, string]>;
  failedFiles?: Set<string>;
  failedFile?: string;
  failedStepId?:
    | "step1-overview"
    | "step5-validation-interrogation";
  failureCause?: "judge rejected" | "deterministic validation failed";
}) {
  const activeFiles = new Set<string>();
  const startedFiles = new Set<string>();

  return {
    async run({ context, step }: { context: FileReviewContext; step: { stepId: string } }) {
      input.stepEvents?.push([step.stepId, context.filePath]);

      if (!startedFiles.has(context.filePath)) {
        startedFiles.add(context.filePath);
        activeFiles.add(context.filePath);
        input.metrics.maxActiveFiles = Math.max(
          input.metrics.maxActiveFiles,
          activeFiles.size
        );

        if (input.metrics.firstStepBootstrapCount === -1) {
          input.metrics.firstStepBootstrapCount = input.getBootstrapPublishCount();
        }
      }

      const isFailedFile =
        input.failedFiles?.has(context.filePath) === true ||
        context.filePath === input.failedFile;
      const isFailedStep = step.stepId === input.failedStepId;

      if (isFailedFile && isFailedStep) {
        await sleep(input.completionDelayByFile.get(context.filePath) ?? 0);
        activeFiles.delete(context.filePath);
        input.metrics.completionOrder.push(context.filePath);
        throw new Error(
          `Step ${step.stepId} failed for ${context.filePath}: ${input.failureCause}`
        );
      }

      if (step.stepId === "step7-summary") {
        await sleep(input.completionDelayByFile.get(context.filePath) ?? 0);
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath, {
        onTerminalApply() {
          if (step.stepId === "step7-summary") {
            activeFiles.delete(context.filePath);
            input.metrics.completionOrder.push(context.filePath);
          }
        }
      });
    }
  };
}

function createSharedAbortRunner(input: {
  stepEvents: Array<[string, string]>;
  gateByFileAndStep?: Map<string, Promise<void>>;
  failByFileAndStep?: Map<string, string>;
}) {
  return {
    async run({ context, step }: { context: FileReviewContext; step: { stepId: string } }) {
      input.stepEvents.push([step.stepId, context.filePath]);

      const gate = input.gateByFileAndStep?.get(`${context.filePath}:${step.stepId}`);

      if (gate) {
        await gate;
      }

      const failureCause = input.failByFileAndStep?.get(
        `${context.filePath}:${step.stepId}`
      );

      if (failureCause) {
        throw new Error(
          `Step ${step.stepId} failed for ${context.filePath}: ${failureCause}`
        );
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath, {
        onTerminalApply() {}
      });
    }
  };
}

function buildSuccessfulStepResult(
  stepId: string,
  filePath: string,
  options: { onTerminalApply(): void }
) {
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
          findings: buildFindingsForFile(filePath)
        });
      }
    };
  }

  if (stepId === "step6-cognitive-simulation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.updateStructuredState({
          findings: buildFindingsForFile(filePath)
        });
      }
    };
  }

  if (stepId === "step7-summary") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection("summary", buildSummaryResponse(filePath));
        options.onTerminalApply();
      }
    };
  }

  throw new Error(`Unexpected step: ${stepId}`);
}

function buildFindingsForFile(filePath: string): Finding[] {
  if (filePath === "src/app.ts") {
    return [
      createFinding("must", "must finding"),
      createFinding("nice", "nice finding")
    ];
  }

  if (filePath === "packages/app/index.ts") {
    return [createFinding("must", "only must finding")];
  }

  return [];
}

function createFinding(type: "must" | "nice", title: string): Finding {
  return {
    type,
    title,
    context: "具體情境",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    confidence: 90
  };
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
    `  - W1: 觸發條件：${filePath} 輸入為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 直接調整處理流程`
  ].join("\n");
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

class BootstrapTrackingOutputSink {
  readonly #delegate = new LocalWorkspaceProvider();
  bootstrapPublishCount = 0;

  initializeRun(outputTarget: Parameters<LocalWorkspaceProvider["initializeRun"]>[0]) {
    this.#delegate.initializeRun(outputTarget);
  }

  publishFileReview(
    fileResult: Parameters<LocalWorkspaceProvider["publishFileReview"]>[0]
  ) {
    if (/- Status: Review not yet generated\./u.test(fileResult.content)) {
      this.bootstrapPublishCount += 1;
    }

    this.#delegate.publishFileReview(fileResult);
  }

  publishSkippedFile(
    skipRecord: Parameters<LocalWorkspaceProvider["publishSkippedFile"]>[0]
  ) {
    this.#delegate.publishSkippedFile(skipRecord);
  }

  publishRunSummary(
    summaryResult: Parameters<LocalWorkspaceProvider["publishRunSummary"]>[0]
  ) {
    this.#delegate.publishRunSummary(summaryResult);
  }

  publishReviewIndex(
    indexResult: Parameters<LocalWorkspaceProvider["publishReviewIndex"]>[0]
  ) {
    this.#delegate.publishReviewIndex(indexResult);
  }
}

class SummaryFailingOutputSink {
  #outputTarget?: {
    basePath: string;
    filesPath: string;
    skippedPath: string;
    summaryPath: string;
    indexPath: string;
  };
  writtenFileReviews: string[] = [];
  publishRunSummaryCalls = 0;
  summaryPath?: string;

  initializeRun(outputTarget: {
    basePath: string;
    filesPath: string;
    skippedPath: string;
    summaryPath: string;
    indexPath: string;
  }) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.summaryPath = outputTarget.summaryPath;
  }

  publishFileReview(fileResult: { noteFilePath: string; content: string }) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    this.writtenFileReviews.push(fileResult.noteFilePath);
  }

  publishSkippedFile(skipRecord: { filePath: string; stepId: string; reason: string }) {
    appendFileSync(
      this.#outputTarget!.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary() {
    this.publishRunSummaryCalls += 1;
    throw new Error("summary write failed");
  }

  publishReviewIndex() {
    throw new Error("should not publish index after summary failure");
  }
}

class SingleFileSnapshotFailingOutputSink {
  #outputTarget?: {
    basePath: string;
    filesPath: string;
    skippedPath: string;
    summaryPath: string;
    indexPath: string;
  };
  readonly #failedNotePath: string;
  #failed = false;

  constructor(input: { failedNotePath: string }) {
    this.#failedNotePath = input.failedNotePath;
  }

  initializeRun(outputTarget: {
    basePath: string;
    filesPath: string;
    skippedPath: string;
    summaryPath: string;
    indexPath: string;
  }) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: { noteFilePath: string; content: string }) {
    if (
      !this.#failed &&
      fileResult.noteFilePath === this.#failedNotePath &&
      !/- Status: Review not yet generated\./u.test(fileResult.content)
    ) {
      this.#failed = true;
      throw new Error("file review write failed");
    }

    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
  }

  assessSuccessfulSnapshotFailure() {
    return { faultScope: "single-file-output-fault" as const };
  }

  publishSkippedFile(skipRecord: { filePath: string; stepId: string; reason: string }) {
    appendFileSync(
      this.#outputTarget!.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: { content: string }) {
    writeFileSync(this.#outputTarget!.summaryPath, summaryResult.content);
  }

  publishReviewIndex(indexResult: { content: string }) {
    writeFileSync(this.#outputTarget!.indexPath, indexResult.content);
  }
}

class SharedTargetSnapshotFailingOutputSink {
  #outputTarget?: {
    basePath: string;
    filesPath: string;
    skippedPath: string;
    summaryPath: string;
    indexPath: string;
  };
  readonly #failedNotePath: string;
  readonly #failedFile: string;
  readonly #onFailedSuccessfulSnapshotPublish?: () => void;
  #failed = false;
  siblingSuccessfulSnapshotCount = 0;
  siblingSkippedRecordCount = 0;

  constructor(input: {
    failedNotePath: string;
    failedFile: string;
    onFailedSuccessfulSnapshotPublish?(): void;
  }) {
    this.#failedNotePath = input.failedNotePath;
    this.#failedFile = input.failedFile;
    this.#onFailedSuccessfulSnapshotPublish = input.onFailedSuccessfulSnapshotPublish;
  }

  initializeRun(outputTarget: {
    basePath: string;
    filesPath: string;
    skippedPath: string;
    summaryPath: string;
    indexPath: string;
  }) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: { noteFilePath: string; content: string }) {
    const isBootstrap = /- Status: Review not yet generated\./u.test(fileResult.content);
    const isInterrupted = /> \[!WARNING\] Review Interrupted/u.test(fileResult.content);

    if (
      !this.#failed &&
      fileResult.noteFilePath === this.#failedNotePath &&
      !isBootstrap &&
      !isInterrupted
    ) {
      this.#failed = true;
      this.#onFailedSuccessfulSnapshotPublish?.();
      throw new Error("disk full");
    }

    if (
      !isBootstrap &&
      !isInterrupted &&
      !fileResult.noteFilePath.includes(this.#failedFile)
    ) {
      this.siblingSuccessfulSnapshotCount += 1;
    }

    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
  }

  assessSuccessfulSnapshotFailure() {
    return { faultScope: "shared-output-target-fault" as const };
  }

  publishSkippedFile(skipRecord: { filePath: string; stepId: string; reason: string }) {
    if (skipRecord.filePath !== this.#failedFile) {
      this.siblingSkippedRecordCount += 1;
    }

    appendFileSync(
      this.#outputTarget!.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: { content: string }) {
    writeFileSync(this.#outputTarget!.summaryPath, summaryResult.content);
  }

  publishReviewIndex(indexResult: { content: string }) {
    writeFileSync(this.#outputTarget!.indexPath, indexResult.content);
  }
}

class SkippedArtifactAbortOutputSink {
  #outputTarget?: {
    basePath: string;
    filesPath: string;
    skippedPath: string;
    summaryPath: string;
    indexPath: string;
  };
  readonly #failedSkippedFile: string;
  readonly #onFailedSkippedPublish?: () => void;
  siblingInterruptedSnapshotCount = 0;
  siblingSkippedRecordCount = 0;

  constructor(input: {
    failedSkippedFile: string;
    onFailedSkippedPublish?(): void;
  }) {
    this.#failedSkippedFile = input.failedSkippedFile;
    this.#onFailedSkippedPublish = input.onFailedSkippedPublish;
  }

  initializeRun(outputTarget: {
    basePath: string;
    filesPath: string;
    skippedPath: string;
    summaryPath: string;
    indexPath: string;
  }) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: { noteFilePath: string; content: string }) {
    if (
      /> \[!WARNING\] Review Interrupted/u.test(fileResult.content) &&
      !fileResult.noteFilePath.includes(this.#failedSkippedFile)
    ) {
      this.siblingInterruptedSnapshotCount += 1;
    }

    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
  }

  publishSkippedFile(skipRecord: { filePath: string; stepId: string; reason: string }) {
    if (skipRecord.filePath === this.#failedSkippedFile) {
      this.#onFailedSkippedPublish?.();
      throw new Error("skipped log write failed");
    }

    this.siblingSkippedRecordCount += 1;
    appendFileSync(
      this.#outputTarget!.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: { content: string }) {
    writeFileSync(this.#outputTarget!.summaryPath, summaryResult.content);
  }

  publishReviewIndex(indexResult: { content: string }) {
    writeFileSync(this.#outputTarget!.indexPath, indexResult.content);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertSuccessfulFileOrder(
  summaryContent: string,
  expectedFileOrder: string[]
): void {
  const positions = expectedFileOrder.map(
    (filePath) => summaryContent.indexOf(`- \`${filePath}\``)
  );

  for (const position of positions) {
    assert.ok(position >= 0);
  }

  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index]);
  }
}
