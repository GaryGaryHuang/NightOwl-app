import type { ReviewPerFileStepsFactory } from "../../src/core/orchestrator.ts";
import type { StepDefinition } from "../../src/core/step-runner.ts";
import type { ReviewSourceSnapshotProvider } from "../../src/providers/local-review-source-snapshot-provider.ts";
import { buildSuccessfulStepResult } from "./orchestrator-fixture.ts";

/**
 * A minimal single-step factory for app-level tests that need per-file
 * pipeline execution without caring about the step content.
 */
export function createSingleStepFactory(): ReviewPerFileStepsFactory {
  return (): StepDefinition[] => [
    {
      stepId: "review-summary",
      prepare(context) {
        return {
          stepId: "review-summary",
          prompt: {
            systemMessage: "custom system",
            userMessage: `review ${context.filePath}`
          },
          reviewProfile: {
            knowledgeMode: "disabled",
            model: "gpt-5.4-mini"
          },
          async resolve() {
            return (fileContext) => {
              buildSuccessfulStepResult("review-summary", fileContext.filePath).applyTo(fileContext);
            };
          }
        };
      }
    }
  ];
}

/**
 * A passthrough snapshot provider that treats the repo as both the original
 * and the snapshot root (no real worktree isolation). Useful for app tests
 * that don't exercise snapshot routing.
 */
export function createPassthroughSnapshotProvider(
  repoRoot: string
): ReviewSourceSnapshotProvider {
  return {
    async createSnapshot() {
      return {
        originalRepoRoot: repoRoot,
        reviewSourceRoot: repoRoot,
        resolvedBaseRef: "main",
        resolvedHeadRef: "feature-branch",
        isDirty: false,
        async cleanup() {}
      };
    }
  };
}

/**
 * A clientManager that throws if getClient() is ever called — for tests
 * where Copilot sessions must not be created.
 */
export function createUnusedClientManager() {
  return {
    async start() {},
    async stop() {},
    async forceStop() {},
    getClient() {
      throw new Error("clientManager.getClient() must not be called by this test");
    }
  };
}
