import { readFileSync, realpathSync } from "node:fs";

import type { Finding } from "../../src/core/file-review-context.ts";
import { planNoteFiles, type OutputTarget } from "../../src/core/review-path-resolver.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import {
  buildDependenciesResponse,
  buildKnowledgeResponse,
  buildOverviewResponse,
  buildStrategyResponse,
  detectStepId,
  extractDiffPath
} from "./orchestrator-fixture.ts";

export type StepId =
  | "step1-overview"
  | "step2-dependencies-boundaries"
  | "step3-knowledge-source-of-truth"
  | "step4-strategy-what-if-scenarios"
  | "step5-validation-interrogation"
  | "step6-cognitive-simulation"
  | "step7-summary";

// realpathSync resolves symlinks so the path matches what the git provider
// returns internally, avoiding false-positive path mismatches in assertions.
export function collectReviewableFiles(input: {
  sourceProvider: {
    getChangedFiles(repoRoot: string, baseRef: string, headRef: string): string[];
  };
  reviewFileFilter: {
    filterReviewableFiles(repoRoot: string, files: string[]): string[];
  };
  repoDir: string;
  baseRef?: string;
  headRef?: string;
}) {
  const repoRoot = realpathSync(input.repoDir);
  const reviewableFiles = input.reviewFileFilter.filterReviewableFiles(
    repoRoot,
    input.sourceProvider.getChangedFiles(
      repoRoot,
      input.baseRef ?? "main",
      input.headRef ?? "feature-branch"
    )
  );

  return { repoRoot, reviewableFiles };
}

export function loadPlannedNoteContents(
  outputTarget: OutputTarget,
  reviewableFiles: string[]
) {
  return planNoteFiles(outputTarget.filesPath, reviewableFiles).map((plannedNote) => ({
    ...plannedNote,
    content: readFileSync(plannedNote.noteFilePath, "utf8")
  }));
}

// Validates that each observed session profile was routed to the expected
// model tier. Steps 1, 3, and 7 use the cheaper mini model; Steps 2, 4, 5,
// and 6 use the frontier model. Throws with a descriptive message on mismatch
// so test failures pinpoint the offending step.
export function assertObservedProfilesUseExpectedModels(
  observedProfiles: Array<Record<string, string>>,
  outputBaseDir: string,
  repoRoot: string
): void {
  for (const profile of observedProfiles) {
    if (profile.outputBaseDir !== outputBaseDir) {
      throw new Error(`unexpected outputBaseDir: ${profile.outputBaseDir}`);
    }

    if (profile.repoRoot !== repoRoot) {
      throw new Error(`unexpected repoRoot: ${profile.repoRoot}`);
    }

    if (profile.workingDirectory !== repoRoot) {
      throw new Error(`unexpected workingDirectory: ${profile.workingDirectory}`);
    }

    if (
      /## Current Step: Overview/u.test(profile.systemMessage) ||
      /## Current Step: Knowledge & Source of Truth/u.test(profile.systemMessage) ||
      /## Current Step: Summary/u.test(profile.systemMessage)
    ) {
      if (profile.model !== "gpt-5-mini") {
        throw new Error(`unexpected mini-model routing: ${profile.model}`);
      }
    } else if (profile.model !== "gpt-5.4-mini") {
      throw new Error(`unexpected frontier-model routing: ${profile.model}`);
    }
  }
}

export function createStepResponseRouter(input: {
  step5Response: (filePath: string) => string;
  step6Response: (filePath: string) => string;
  step7Response: (filePath: string) => string;
}) {
  return (stepId: StepId, filePath: string): string => {
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
      return input.step5Response(filePath);
    }

    if (stepId === "step6-cognitive-simulation") {
      return input.step6Response(filePath);
    }

    return input.step7Response(filePath);
  };
}

/**
 * Builds a StepRunner instrumented with recording arrays for session profiles,
 * prompts, step events, and disconnects. Tests inject custom step responses
 * via `buildStepResponse` and assert against the recorded arrays afterwards.
 *
 * The judgeService defaults to always-pass so step-runner contract tests that
 * do not exercise the judge path remain simple.
 */
export function createObservedStepRunner(input: {
  buildStepResponse: (stepId: StepId, filePath: string) => string;
  observedDisconnects: string[];
  observedProfiles: Array<Record<string, string>>;
  observedPrompts: Array<{ stepId: StepId; prompt: string }>;
  observedStepEvents: Array<[StepId, string]>;
  disconnectValue?: (stepId: StepId) => string;
  expectedTimeoutMs?: number;
  structuredOutputValidator?: InstanceType<typeof StructuredOutputValidator> | {
    validate: (input: {
      validatorId: "findings-json";
      responseText: string;
      diffContent?: string;
    }) => { findings: Finding[] };
  };
  judgeService?: {
    evaluate: (input: {
      stepId: string;
      filePath: string;
      criteria: string;
      sectionContent: string;
    }) => Promise<{ passed: boolean; cause?: string }>;
  };
}): StepRunner {
  return new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        input.observedProfiles.push(profile as Record<string, string>);
        const stepId = detectStepId(profile.systemMessage);

        return new SessionExecutor({
          async sendAndWait(options, timeoutMs) {
            const filePath = extractDiffPath(options.prompt);

            input.observedPrompts.push({ stepId, prompt: options.prompt });
            input.observedStepEvents.push([stepId, filePath]);

            if (input.expectedTimeoutMs !== undefined && timeoutMs !== input.expectedTimeoutMs) {
              throw new Error(`unexpected timeout: ${timeoutMs}`);
            }

            return {
              data: {
                content: input.buildStepResponse(stepId, filePath)
              }
            };
          },
          async disconnect() {
            input.observedDisconnects.push(
              input.disconnectValue?.(stepId) ?? stepId
            );
          }
        });
      }
    },
    structuredOutputValidator:
      input.structuredOutputValidator ?? new StructuredOutputValidator(),
    judgeService:
      input.judgeService ?? {
        async evaluate() {
          return { passed: true };
        }
      }
  });
}
