import { createRunContext, type RunContext } from "./run-context.ts";

export interface ChangesetOverviewRunnerInput {
  model: string;
  changedFilesList: string[];
  outputBaseDir: string;
  repoRoot: string;
  userContext: string[];
  workingDirectory?: string;
}

export interface ReviewSessionFactoryLike {
  createSession(profile: {
    model: string;
    systemMessage: string;
    workingDirectory?: string;
  }): Promise<{
    sendAndWait(prompt: string, timeoutMs?: number): Promise<string | undefined>;
  }>;
}

export interface ChangesetOverviewRunnerOptions {
  reviewSessionFactory: ReviewSessionFactoryLike;
}

export class ChangesetOverviewRunner {
  readonly #reviewSessionFactory: ReviewSessionFactoryLike;

  constructor(options: ChangesetOverviewRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
  }

  async run(input: ChangesetOverviewRunnerInput): Promise<RunContext> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.#reviewSessionFactory.createSession({
        model: input.model,
        outputBaseDir: input.outputBaseDir,
        repoRoot: input.repoRoot,
        systemMessage: STEP0_SYSTEM_MESSAGE,
        workingDirectory: input.workingDirectory
      });
      const response = (await session.sendAndWait(buildStep0Prompt(input)))?.trim();

      if (response) {
        return createRunContext({
          changesetOverview: response,
          userContext: input.userContext
        });
      }
    }

    throw new Error("Step 0 changeset overview did not produce a non-empty response.");
  }
}

const STEP0_SYSTEM_MESSAGE = [
  "## Current Step: Changeset Overview",
  "- This is a run-level step. Establish a high-level understanding of the overall changeset before per-file review begins.",
  "- Begin the response with `## Changeset Overview`."
].join("\n");

function buildStep0Prompt(input: ChangesetOverviewRunnerInput): string {
  const changedFilesBlock =
    input.changedFilesList.length > 0
      ? input.changedFilesList.join("\n")
      : "(no changed files)";
  const userContextBlock =
    input.userContext.length > 0 ? input.userContext.join("\n") : "(no user context)";

  return [
    "Analyze the changeset across all files in <changed_files> and produce a high-level overview for subsequent per-file review.",
    "",
    "<changed_files>",
    changedFilesBlock,
    "</changed_files>",
    "",
    "<user_context>",
    userContextBlock,
    "</user_context>"
  ].join("\n");
}
