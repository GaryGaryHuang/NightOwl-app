import { createRunContext, type RunContext } from "./run-context.ts";
import { retryOnce } from "./session-retry.ts";
import type { ReviewSessionFactoryLike } from "./session-factory-contracts.ts";
import {
  STEP0_SYSTEM_MESSAGE,
  STEP0_TIMEOUT_MS,
  buildStep0Prompt
} from "./steps/step0-changeset-overview.ts";

export interface ChangesetOverviewRunnerInput {
  model: string;
  changedFilesList: string[];
  outputBaseDir: string;
  repoRoot: string;
  signal?: AbortSignal;
  userContext: string[];
  workingDirectory?: string;
}

export interface ChangesetOverviewRunnerOptions {
  reviewSessionFactory: ReviewSessionFactoryLike;
}

/**
 * Run the run-level Step 0 review once, retrying only if the response is blank or the session fails.
 */
export class ChangesetOverviewRunner {
  readonly #reviewSessionFactory: ReviewSessionFactoryLike;

  constructor(options: ChangesetOverviewRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
  }

  async run(input: ChangesetOverviewRunnerInput): Promise<RunContext> {
    return retryOnce({
      execute: async () => {
        const session = await this.#reviewSessionFactory.createSession({
          stepId: "changeset-overview",
          knowledgeMode: "built-in-context7",
          model: input.model,
          outputBaseDir: input.outputBaseDir,
          repoRoot: input.repoRoot,
          systemMessage: STEP0_SYSTEM_MESSAGE,
          workingDirectory: input.workingDirectory
        });
        const response = (
          await session.sendAndWait(
            buildStep0Prompt(input),
            STEP0_TIMEOUT_MS,
            input.signal
          )
        )?.trim();

        if (!response) {
          throw new Error(
            "Step 0 changeset overview did not produce a non-empty response."
          );
        }

        return createRunContext({
          changesetOverview: response,
          userContext: input.userContext
        });
      },
      buildFinalError(lastCause) {
        return new Error(lastCause);
      }
    });
  }
}
