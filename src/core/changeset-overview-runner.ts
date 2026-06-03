import { type ChangeMapReadiness } from "./change-map.ts";
import { createRunContext, type RunContext } from "./run-context.ts";
import { retryWithLimit } from "./session-retry.ts";
import type { ReviewChangesetEntry } from "../providers/review-source-provider.ts";
import type { ReviewSessionFactoryLike } from "./session-factory-contracts.ts";
import {
  ChangesetOverviewOutputValidationError,
  type ChangesetOverviewValidationDiagnostic,
  ChangesetOverviewOutputValidator
} from "./changeset-overview-output-validator.ts";
import {
  CHANGESET_OVERVIEW_REVIEW_PROFILE,
  CHANGESET_OVERVIEW_SYSTEM_MESSAGE,
  buildChangesetOverviewPrompt,
  buildChangesetOverviewRetryRepairPrompt
} from "./steps/changeset-overview-step.ts";
import { CHANGESET_OVERVIEW_STEP_ID } from "./review-step-ids.ts";

export interface ChangesetOverviewRunnerInput {
  changesetEntries: ReviewChangesetEntry[];
  repoRoot: string;
  reviewOutputRoot?: string;
  signal?: AbortSignal;
  sourceBaseRef?: string;
  sourceHeadRef?: string;
  userContext: string[];
  workingDirectory?: string;
}

export interface ChangesetOverviewRunnerOptions {
  reviewSessionFactory: ReviewSessionFactoryLike;
  /** Optional injection point; defaults to a fresh `ChangesetOverviewOutputValidator`. */
  changesetOverviewOutputValidator?: ChangesetOverviewOutputValidator;
  onChangesetOverviewLogEvent?: (event: ChangesetOverviewLogEvent) => void;
}

export interface ChangesetOverviewLogEvent {
  readonly message: string;
}

/**
 * Run the run-level Changeset Overview review once, retrying only if the response is blank or the session fails.
 */
export class ChangesetOverviewRunner {
  readonly #reviewSessionFactory: ReviewSessionFactoryLike;
  readonly #validator: ChangesetOverviewOutputValidator;
  readonly #onChangesetOverviewLogEvent?: (event: ChangesetOverviewLogEvent) => void;

  constructor(options: ChangesetOverviewRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
    this.#validator = options.changesetOverviewOutputValidator ?? new ChangesetOverviewOutputValidator();
    this.#onChangesetOverviewLogEvent = options.onChangesetOverviewLogEvent;
  }

  async run(input: ChangesetOverviewRunnerInput): Promise<RunContext> {
    let retryRepairFailure: ChangesetOverviewValidationDiagnostic | undefined;

    return retryWithLimit({
      execute: async (attempt) => {
        const session = await this.#reviewSessionFactory.createSession({
          stepId: CHANGESET_OVERVIEW_STEP_ID,
          knowledgeMode: CHANGESET_OVERVIEW_REVIEW_PROFILE.knowledgeMode,
          model: CHANGESET_OVERVIEW_REVIEW_PROFILE.model,
          repoRoot: input.repoRoot,
          ...(input.reviewOutputRoot === undefined
            ? {}
            : { reviewOutputRoot: input.reviewOutputRoot }),
          ...(input.sourceBaseRef === undefined
            ? {}
            : { sourceBaseRef: input.sourceBaseRef }),
          ...(input.sourceHeadRef === undefined
            ? {}
            : { sourceHeadRef: input.sourceHeadRef }),
          systemMessage: CHANGESET_OVERVIEW_SYSTEM_MESSAGE,
          workingDirectory: input.workingDirectory
        });
        const prompt = retryRepairFailure
          ? buildChangesetOverviewRetryRepairPrompt(input, retryRepairFailure)
          : buildChangesetOverviewPrompt(input);
        const response = await session.sendAndWait(
            prompt,
            CHANGESET_OVERVIEW_REVIEW_PROFILE.timeoutMs,
            input.signal
          );

        if (!response || response.trim().length === 0) {
          retryRepairFailure = {
            code: "PARSE",
            message:
              "Changeset Overview changeset overview did not produce a non-empty response.",
            actualSummary: "empty_response",
            repairHint:
              "Return exactly one JSON object with no surrounding text."
          };
          throw new ChangesetOverviewOutputValidationError(
            "PARSE",
            "Changeset Overview changeset overview did not produce a non-empty response."
          );
        }

        let changeMap: ChangeMapReadiness;
        try {
          const validationResult = this.#validator.validateDetailed({
            responseText: response,
            userContext: input.userContext
          });
          this.#emitSyntaxRepairLog(attempt, validationResult.parseMetadata);
          changeMap = validationResult.changeMap;
          retryRepairFailure = undefined;
        } catch (error) {
          if (error instanceof ChangesetOverviewOutputValidationError) {
            retryRepairFailure = error.diagnostic;
            this.#emitValidationFailureLog(attempt, error.diagnostic);
          }
          throw error;
        }

        return createRunContext({ changesetOverview: changeMap });
      },
      buildFinalError(lastCause) {
        return new Error(lastCause);
      }
    });
  }

  #emitSyntaxRepairLog(
    attempt: number,
    metadata: { repairKind: string; responseByteLength: number; parsedByteLength: number }
  ): void {
    if (metadata.repairKind === "none") {
      return;
    }

    this.#emitLog(
      `Changeset Overview JSON syntax repair applied (attempt ${attempt + 1}, repair=${metadata.repairKind}, responseBytes=${metadata.responseByteLength}, parsedBytes=${metadata.parsedByteLength})`
    );
  }

  #emitValidationFailureLog(
    attempt: number,
    diagnostic: ChangesetOverviewValidationDiagnostic
  ): void {
    const fields = [
      `attempt ${attempt + 1}`,
      `code=${diagnostic.code}`,
      diagnostic.parseStage ? `stage=${diagnostic.parseStage}` : undefined,
      diagnostic.offendingPath ? `path=${diagnostic.offendingPath}` : undefined,
      diagnostic.responseByteLength === undefined
        ? undefined
        : `responseBytes=${diagnostic.responseByteLength}`,
      diagnostic.errorPosition === undefined
        ? undefined
        : `position=${diagnostic.errorPosition}`,
      diagnostic.errorLine === undefined ? undefined : `line=${diagnostic.errorLine}`,
      diagnostic.errorColumn === undefined
        ? undefined
        : `column=${diagnostic.errorColumn}`,
      diagnostic.allowedValues === undefined
        ? undefined
        : `allowed=${JSON.stringify(diagnostic.allowedValues)}`,
      diagnostic.responseExcerpt === undefined
        ? undefined
        : `excerpt=${JSON.stringify(diagnostic.responseExcerpt)}`,
      `message=${JSON.stringify(diagnostic.message)}`
    ].filter((field): field is string => field !== undefined);

    this.#emitLog(`Changeset Overview validation failed (${fields.join(", ")})`);
  }

  #emitLog(message: string): void {
    this.#onChangesetOverviewLogEvent?.({ message });
  }
}
