import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { RunRequest } from "../../src/core/run-request.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import type { ReviewRepoFixture } from "./git-fixture.ts";
import type { StepId } from "./orchestrator-step-contract-fixture.ts";

export const STRUCTURED_STEP_RUN_REQUEST: RunRequest = {
  baseRef: "main",
  headRef: "feature-branch",
  repoPath: "./packages/app",
  userContext: [],
  dryRun: false
};

const CHANGESET_OVERVIEW_RUNNER = {
  async run() {
    return createRunContext({
      changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
      userContext: []
    });
  }
};

export type ReviewStepFailureResponse = {
  data?: {
    content?: string;
  };
};

export function createStructuredStepTestOrchestrator(
  fixture: ReviewRepoFixture,
  stepRunner: StepRunner,
  deps?: {
    sourceProvider?: InstanceType<typeof LocalGitProvider>;
    reviewFileFilter?: InstanceType<typeof LocalReviewFileFilter>;
  }
) {
  const sourceProvider = deps?.sourceProvider ?? new LocalGitProvider();
  const reviewFileFilter = deps?.reviewFileFilter ?? new LocalReviewFileFilter();
  const orchestrator = new ReviewOrchestrator({
    sourceProvider,
    reviewFileFilter,
    outputSink: new LocalWorkspaceProvider(),
    stepRunner,
    changesetOverviewRunner: CHANGESET_OVERVIEW_RUNNER,
    workingDirectory: fixture.repoDir,
    timestampProvider: () => "03131430"
  });
  return { orchestrator, sourceProvider, reviewFileFilter };
}

export function addThirdChangedFile(
  fixture: ReviewRepoFixture,
  commitMessage: string
): void {
  fixture.writeFile("README.md", "# Demo feature change\n");
  fixture.commitAll(commitMessage);
}

export function countStepAttempts(
  observedStepEvents: Array<[StepId, string]>,
  stepId: StepId,
  filePath: string
): number {
  return observedStepEvents.filter(([s, f]) => s === stepId && f === filePath).length;
}
