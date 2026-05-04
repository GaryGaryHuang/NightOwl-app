import {
  extractChangedPathsFromChangesetEntries,
  type ChangeMapReadiness
} from "./change-map.ts";
import { createRunContext, type RunContext } from "./run-context.ts";
import { retryOnce } from "./session-retry.ts";
import type { ReviewChangesetEntry } from "../providers/review-source-provider.ts";
import type { ReviewSessionFactoryLike } from "./session-factory-contracts.ts";
import {
  Step0OutputValidationError,
  Step0OutputValidator
} from "./step0-output-validator.ts";
import {
  STEP0_REVIEW_PROFILE,
  STEP0_SYSTEM_MESSAGE,
  buildStep0Prompt,
  buildStep0RetryRepairPrompt
} from "./steps/step0-changeset-overview.ts";

export interface ChangesetOverviewRunnerInput {
  changesetEntries: ReviewChangesetEntry[];
  outputBaseDir: string;
  repoRoot: string;
  signal?: AbortSignal;
  userContext: string[];
  workingDirectory?: string;
}

export interface ChangesetOverviewRunnerOptions {
  reviewSessionFactory: ReviewSessionFactoryLike;
  /** Optional injection point; defaults to a fresh `Step0OutputValidator`. */
  step0OutputValidator?: Step0OutputValidator;
}

/**
 * Run the run-level Step 0 review once, retrying only if the response is blank or the session fails.
 */
export class ChangesetOverviewRunner {
  readonly #reviewSessionFactory: ReviewSessionFactoryLike;
  readonly #validator: Step0OutputValidator;

  constructor(options: ChangesetOverviewRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
    this.#validator = options.step0OutputValidator ?? new Step0OutputValidator();
  }

  async run(input: ChangesetOverviewRunnerInput): Promise<RunContext> {
    const expectedChangedPaths = extractChangedPathsFromChangesetEntries(
      input.changesetEntries
    );
    let retryRepairFailure: string | undefined;

    return retryOnce({
      execute: async () => {
        const session = await this.#reviewSessionFactory.createSession({
          stepId: "changeset-overview",
          knowledgeMode: STEP0_REVIEW_PROFILE.knowledgeMode,
          model: STEP0_REVIEW_PROFILE.model,
          outputBaseDir: input.outputBaseDir,
          repoRoot: input.repoRoot,
          systemMessage: STEP0_SYSTEM_MESSAGE,
          workingDirectory: input.workingDirectory
        });
        const prompt = retryRepairFailure
          ? buildStep0RetryRepairPrompt(input, retryRepairFailure)
          : buildStep0Prompt(input);
        const response = (
          await session.sendAndWait(
            prompt,
            STEP0_REVIEW_PROFILE.timeoutMs,
            input.signal
          )
        )?.trim();

        if (!response) {
          throw new Error(
            "Step 0 changeset overview did not produce a non-empty response."
          );
        }

        let changeMap: ChangeMapReadiness;
        try {
          changeMap = this.#validator.validate({
            responseText: response,
            expectedChangedPaths,
            expectedUserContext: input.userContext
          });
          retryRepairFailure = undefined;
        } catch (error) {
          if (error instanceof Step0OutputValidationError) {
            retryRepairFailure = error.message;
          }
          throw error;
        }

        return createRunContext({
          changesetOverview: changeMap,
          userContext: input.userContext
        });
      },
      buildFinalError(lastCause) {
        return new Error(lastCause);
      }
    });
  }
}
