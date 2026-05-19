import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ChangesetOverviewRunner } from "../src/core/changeset-overview-runner.ts";
import { FileReviewContext } from "../src/core/file-review-context.ts";
import type { RunContext } from "../src/core/run-context.ts";
import { ReviewStatePromptSerializer } from "../src/core/review-state-prompt-serializer.ts";
import { StepRunner } from "../src/core/step-runner.ts";
import { StructuredOutputValidator } from "../src/core/structured-output-validator.ts";
import { ReviewBasisStep } from "../src/core/steps/review-basis-step.ts";
import { CandidateFindingsStep } from "../src/core/steps/candidate-findings-step.ts";
import { SemanticValidationStep } from "../src/core/steps/semantic-validation-step.ts";
import { ReviewSummaryStep } from "../src/core/steps/review-summary-step.ts";
import { LocalGitProvider } from "../src/providers/local-git-provider.ts";
import { KnowledgeSvc } from "../src/services/knowledge.ts";
import { CopilotClientManager } from "../src/services/copilot-client-manager.ts";
import { ReviewSessionFactory } from "../src/services/review-session-factory.ts";
import { ToolPolicyGuard } from "../src/services/tool-policy/tool-policy-guard.ts";

const DEFAULT_REPO = "/Users/garyhsu/StudioProjects/kkbox_android";
const DEFAULT_BASE = "feature-shazam";
const DEFAULT_HEAD = "garyhuang/KS-2794-shazam-usecase";
const DEFAULT_BASELINE_DIR =
  "/Users/garyhsu/StudioProjects/kkbox_android/.nightowl/review/garyhuang_KS-2794-shazam-usecase_05061338";
const DEFAULT_BASIS_FILES = [
  "KKBOX/src/main/java/com/kkbox/domain/usecase/implementation/RecognizeMusicUseCaseImpl.kt",
  "KKBOX/src/main/java/com/kkbox/recognition/provider/ShazamRecognitionProvider.kt",
  "KKBOX/src/main/java/com/kkbox/domain/repository/implementation/MusicRecognitionTokenRepositoryImpl.kt",
  "KKBOX/src/main/java/com/kkbox/domain/repository/implementation/MusicRecognitionMappingRepositoryImpl.kt",
  "KKBOX/src/main/java/com/kkbox/recognition/viewmodel/MusicRecognitionViewModel.kt"
] as const;

interface ScriptConfig {
  repo: string;
  baseRef: string;
  headRef: string;
  baselineDir: string;
  basisFiles: string[];
  semanticFile: string;
  runs: number;
}

interface ChangesetOverviewRunSummary {
  run: number;
  behaviorChangeCount: number;
  unresolvedUnknownCount: number;
  missingInformationCount: number;
  overviewHash: string;
  objectiveSummary: string;
}

interface BasisRunSummary {
  filePath: string;
  run: number;
  roleInChangeset: string;
  changedBehaviorCount: number;
  factCount: number;
  inferenceCount: number;
  hypothesisCount: number;
  missingInformationCount: number;
  evidenceRefCount: number;
}

interface SemanticRunSummary {
  run: number;
  filePath: string;
  candidateResult: string;
  candidateFindingCount: number;
  candidateMissingInformationCount: number;
  validationAction: string;
  approvedFindingCount: number;
  validationMissingInformationCount: number;
  summaryRiskLine: string;
  summaryHash: string;
}

interface ValidationSummary {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  outputBaseDir: string;
  baseline: {
    dir: string;
    indexAvailable: boolean;
    changesetOverviewAvailable: boolean;
  };
  selectedBasisFiles: string[];
  semanticFile: string;
  runs: number;
  changesetOverview: ChangesetOverviewRunSummary[];
  basisStep: BasisRunSummary[];
  semanticPipeline: SemanticRunSummary[];
  retryEvents: string[];
}

const config = parseArgs(process.argv.slice(2));
const retryEvents: string[] = [];

await main(config);

async function main(input: ScriptConfig): Promise<void> {
  const git = new LocalGitProvider();
  const repoRoot = await git.resolveRepoRoot(input.repo);
  const outputBaseDir = await mkdtemp(
    path.join(os.tmpdir(), "nightowl-prompt-validation-")
  );
  const changesetEntries = await git.getChangesetEntries(
    repoRoot,
    input.baseRef,
    input.headRef
  );

  const clientManager = new CopilotClientManager();
  await clientManager.start();

  try {
    const knowledgeSvc = new KnowledgeSvc({
      context7ApiKey: process.env.CONTEXT7_API_KEY
    });
    const reviewSessionFactory = new ReviewSessionFactory({
      clientManager,
      knowledgeSvc,
      toolPolicyGuard: new ToolPolicyGuard({})
    });
    const changesetOverviewRunner = new ChangesetOverviewRunner({
      reviewSessionFactory,
      onChangesetOverviewLogEvent(event) {
        retryEvents.push(`changeset-overview: ${event.message}`);
        console.error(`[changeset-overview] ${event.message}`);
      }
    });
    const stepRunner = new StepRunner({
      reviewSessionFactory,
      structuredOutputValidator: new StructuredOutputValidator(),
      onStepRetry(info) {
        const message = [
          `step=${info.stepId}`,
          `file=${info.filePath}`,
          `attempt=${info.attempt + 1}`,
          info.model ? `model=${info.model}` : undefined,
          info.promptHash ? `promptHash=${info.promptHash}` : undefined,
          info.schemaId ? `schema=${info.schemaId}` : undefined,
          `cause=${info.cause}`
        ].filter((field): field is string => field !== undefined).join(" ");
        retryEvents.push(message);
        console.error(`[retry] ${message}`);
      }
    });
    const promptSerializer = new ReviewStatePromptSerializer();

    const runContexts: RunContext[] = [];
    const changesetOverviewRuns: ChangesetOverviewRunSummary[] = [];

    for (let run = 1; run <= input.runs; run += 1) {
      console.error(`[validate] changeset overview run ${run}/${input.runs}`);
      const runContext = await changesetOverviewRunner.run({
        changesetEntries,
        outputBaseDir,
        repoRoot,
        userContext: [],
        workingDirectory: repoRoot
      });
      runContexts.push(runContext);
      changesetOverviewRuns.push(summarizeChangesetOverview(run, runContext));
    }

    const basisRuns: BasisRunSummary[] = [];
    const runContext = runContexts[0];
    if (!runContext) {
      throw new Error("Changeset Overview did not produce a RunContext.");
    }

    for (const filePath of input.basisFiles) {
      for (let run = 1; run <= input.runs; run += 1) {
        console.error(`[validate] basis-step run ${run}/${input.runs} ${filePath}`);
        const context = await createFileReviewContext({
          git,
          repoRoot,
          baseRef: input.baseRef,
          headRef: input.headRef,
          filePath,
          outputBaseDir
        });
        await runAndApply({
          stepRunner,
          step: new ReviewBasisStep({ runContext }),
          context,
          outputBaseDir,
          repoRoot
        });
        basisRuns.push(summarizeBasis(run, context));
      }
    }

    const semanticRuns: SemanticRunSummary[] = [];
    for (let run = 1; run <= input.runs; run += 1) {
      console.error(
        `[validate] candidate findings -> semantic validation -> review summary run ${run}/${input.runs} ${input.semanticFile}`
      );
      const context = await createFileReviewContext({
        git,
        repoRoot,
        baseRef: input.baseRef,
        headRef: input.headRef,
        filePath: input.semanticFile,
        outputBaseDir
      });
      await runAndApply({
        stepRunner,
        step: new ReviewBasisStep({ runContext }),
        context,
        outputBaseDir,
        repoRoot
      });
      await runAndApply({
        stepRunner,
        step: new CandidateFindingsStep({ promptSerializer }),
        context,
        outputBaseDir,
        repoRoot
      });
      await runAndApply({
        stepRunner,
        step: new SemanticValidationStep({ promptSerializer }),
        context,
        outputBaseDir,
        repoRoot
      });

      const validationReport = context.getValidationReportV1();
      if (validationReport?.loopControl.action === "rerun") {
        throw new Error(
          `Semantic validation requested a Candidate Findings rerun for ${input.semanticFile}; choose a narrower stable semantic file or investigate the candidate.`
        );
      }

      await runAndApply({
        stepRunner,
        step: new ReviewSummaryStep({ promptSerializer }),
        context,
        outputBaseDir,
        repoRoot
      });
      semanticRuns.push(summarizeSemantic(run, context));
    }

    const baseline = await inspectBaseline(input.baselineDir);
    const summary: ValidationSummary = {
      repoRoot,
      baseRef: input.baseRef,
      headRef: input.headRef,
      outputBaseDir,
      baseline,
      selectedBasisFiles: input.basisFiles,
      semanticFile: input.semanticFile,
      runs: input.runs,
      changesetOverview: changesetOverviewRuns,
      basisStep: basisRuns,
      semanticPipeline: semanticRuns,
      retryEvents
    };
    const validationSummaryPath = path.join(
      outputBaseDir,
      "prompt-step-validation-summary.json"
    );
    await writeFile(
      validationSummaryPath,
      `${JSON.stringify(summary, null, 2)}\n`
    );

    console.log(JSON.stringify(summary, null, 2));
    console.error(`[validate] summary written to ${validationSummaryPath}`);
  } finally {
    await clientManager.stop().catch(async () => {
      await clientManager.forceStop();
    });
  }
}

async function createFileReviewContext(input: {
  git: LocalGitProvider;
  repoRoot: string;
  baseRef: string;
  headRef: string;
  filePath: string;
  outputBaseDir: string;
}): Promise<FileReviewContext> {
  const diffContent = await input.git.getDiff(
    input.repoRoot,
    input.baseRef,
    input.headRef,
    input.filePath
  );

  return new FileReviewContext({
    filePath: input.filePath,
    noteFilePath: path.join(input.outputBaseDir, noteFileName(input.filePath)),
    diffContent,
    baseRef: input.baseRef,
    headRef: input.headRef
  });
}

async function runAndApply(input: {
  stepRunner: StepRunner;
  step: ReviewBasisStep | CandidateFindingsStep | SemanticValidationStep | ReviewSummaryStep;
  context: FileReviewContext;
  outputBaseDir: string;
  repoRoot: string;
}): Promise<void> {
  const result = await input.stepRunner.run({
    step: input.step,
    context: input.context,
    outputBaseDir: input.outputBaseDir,
    repoRoot: input.repoRoot,
    workingDirectory: input.repoRoot
  });
  result.applyTo(input.context);
}

function summarizeChangesetOverview(run: number, runContext: RunContext): ChangesetOverviewRunSummary {
  const overview = runContext.changesetOverview;
  return {
    run,
    behaviorChangeCount: overview.behaviorChanges.length,
    unresolvedUnknownCount: overview.unresolvedUnknowns.length,
    missingInformationCount: overview.missingInformation.length,
    overviewHash: sha256(overview.overviewMarkdown),
    objectiveSummary: overview.reviewObjective.summary
  };
}

function summarizeBasis(run: number, context: FileReviewContext): BasisRunSummary {
  const basis = context.getReviewBasis();
  if (!basis) {
    throw new Error(`ReviewBasis missing for ${context.filePath}`);
  }

  return {
    filePath: context.filePath,
    run,
    roleInChangeset: basis.roleInChangeset,
    changedBehaviorCount: basis.changedBehavior.length,
    factCount: basis.facts.length,
    inferenceCount: basis.inferences.length,
    hypothesisCount: basis.hypothesisLedger.length,
    missingInformationCount: basis.missingInformation.length,
    evidenceRefCount: basis.evidenceRefs.length
  };
}

function summarizeSemantic(
  run: number,
  context: FileReviewContext
): SemanticRunSummary {
  const candidatePayload = context.getCandidateFindingsV3();
  const validationReport = context.getValidationReportV1();
  const summary = context.getSection("summary");
  if (!candidatePayload) {
    throw new Error(`CandidateFindingsV3 missing for ${context.filePath}`);
  }
  if (!validationReport) {
    throw new Error(`ValidationReportV1 missing for ${context.filePath}`);
  }
  if (!summary) {
    throw new Error(`Review Summary summary missing for ${context.filePath}`);
  }

  return {
    run,
    filePath: context.filePath,
    candidateResult: candidatePayload.result,
    candidateFindingCount: candidatePayload.findings.length,
    candidateMissingInformationCount:
      candidatePayload.criticalMissingInformation.length,
    validationAction: validationReport.loopControl.action,
    approvedFindingCount: context.getFindings()?.length ?? 0,
    validationMissingInformationCount:
      validationReport.missingInformationItems.length,
    summaryRiskLine: extractSummaryRiskLine(summary),
    summaryHash: sha256(summary)
  };
}

async function inspectBaseline(
  baselineDir: string
): Promise<ValidationSummary["baseline"]> {
  const [indexAvailable, changesetOverviewAvailable] = await Promise.all([
    canRead(path.join(baselineDir, "index.md")),
    canRead(path.join(baselineDir, "changeset-overview.md"))
  ]);
  return {
    dir: baselineDir,
    indexAvailable,
    changesetOverviewAvailable
  };
}

async function canRead(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function parseArgs(args: string[]): ScriptConfig {
  const repo = readOption(args, "--repo") ?? DEFAULT_REPO;
  const baseRef = readOption(args, "--base") ?? DEFAULT_BASE;
  const headRef = readOption(args, "--head") ?? DEFAULT_HEAD;
  const baselineDir = readOption(args, "--baseline-dir") ?? DEFAULT_BASELINE_DIR;
  const basisFiles =
    readOption(args, "--basis-files")?.split(",").map((value) => value.trim()).filter(Boolean) ??
    [...DEFAULT_BASIS_FILES];
  const semanticFile =
    readOption(args, "--semantic-file") ?? DEFAULT_BASIS_FILES[0];
  const runs = Number(readOption(args, "--runs") ?? "2");

  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error("--runs must be a positive integer.");
  }
  if (basisFiles.length === 0) {
    throw new Error("--basis-files must contain at least one file.");
  }

  return {
    repo,
    baseRef,
    headRef,
    baselineDir,
    basisFiles,
    semanticFile,
    runs
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function extractSummaryRiskLine(summary: string): string {
  return summary
    .split(/\r?\n/u)
    .find((line) => line.includes("整體風險等級"))?.trim() ?? "";
}

function noteFileName(filePath: string): string {
  return `${filePath.replace(/[^A-Za-z0-9._-]+/gu, "__")}.md`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
