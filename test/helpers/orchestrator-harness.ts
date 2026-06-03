import { createRunContext, type RunContext } from "../../src/core/run-context.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { stubChangeMap } from "./change-map-stub.ts";
import type { ReviewRepoFixture } from "./git-fixture.ts";

export const BASE_REF = "main";
export const HEAD_REF = "feature-branch";
export const RUN_TIMESTAMP = "03131430";

export const REQUEST = {
  baseRef: BASE_REF,
  headRef: HEAD_REF,
  repoPath: "./packages/app",
  userContext: [],
  dryRun: false
};

export interface ReviewHarness {
  fixture: ReviewRepoFixture;
  repoRoot: string;
  reviewableFiles: string[];
  reviewFileFilter: LocalReviewFileFilter;
  sourceProvider: LocalGitProvider;
}

export async function bootstrapReviewHarness(
  fixture: ReviewRepoFixture
): Promise<ReviewHarness> {
  const sourceProvider = new LocalGitProvider();
  const reviewFileFilter = new LocalReviewFileFilter();
  const repoRoot = await sourceProvider.resolveRepoRoot(fixture.appDir);
  const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
    repoRoot,
    await sourceProvider.getChangedFiles(repoRoot, BASE_REF, HEAD_REF)
  );

  return {
    fixture,
    repoRoot,
    reviewableFiles,
    reviewFileFilter,
    sourceProvider
  };
}

export function createDefaultChangesetOverviewRunner(): {
  run(): Promise<RunContext>;
} {
  return {
    async run() {
      return createRunContext({
        changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature")
      });
    }
  };
}
