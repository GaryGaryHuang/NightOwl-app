import {
  type FileReviewContextInput,
  FileReviewContext
} from "../../src/core/file-review-context.ts";
import type { ReviewSectionKey } from "../../src/core/review-section-contract.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../../src/core/review-runtime-contract.ts";
import {
  type StepExecutionPlan,
  type StepResolveServices,
  StepRunner
} from "../../src/core/step-runner.ts";
import type { ReviewSessionFactoryLike } from "../../src/core/session-factory-contracts.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";

const DEFAULT_CONTEXT_INPUT: FileReviewContextInput = {
  filePath: "src/app.ts",
  noteFilePath: "/workspace/output/.nightowl/review/run/files/src__app.ts.md",
  diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
  baseRef: "main",
  headRef: "feature-branch"
};

export function createStepRunnerContext(
  overrides: Partial<FileReviewContextInput> = {}
): FileReviewContext {
  return new FileReviewContext({
    ...DEFAULT_CONTEXT_INPUT,
    ...overrides
  });
}

// Minimal step-definition factory used by tests that focus on StepRunner
// behavior (retry, error wrapping) rather than prompt content or validator logic.
export function createSectionTestStep(input: {
  stepId?: string;
  sectionKey?: ReviewSectionKey;
  systemMessage?: string;
  userMessage?: string;
  reviewProfile?: StepExecutionPlan["reviewProfile"];
  resolve?: StepExecutionPlan["resolve"];
}) {
  const stepId = input.stepId ?? "review-summary";
  const sectionKey = input.sectionKey ?? "summary";

  return {
    stepId,
    prepare() {
      return {
        stepId,
        prompt: {
          systemMessage: input.systemMessage ?? "system prompt",
          userMessage: input.userMessage ?? "user prompt"
        },
        reviewProfile: input.reviewProfile ?? {
          knowledgeMode: "disabled",
          model: "gpt-5-mini",
          timeoutMs: REVIEW_TURN_TIMEOUT_MS
        },
        resolve: input.resolve ?? (async (response: string) => {
          return (context: FileReviewContext) => {
            context.setSection(sectionKey, response);
          };
        })
      };
    }
  };
}

export function makeSectionResolveWithDeterministicCheck(
  sectionKey: ReviewSectionKey,
  check: (response: string) => string | undefined
): StepExecutionPlan["resolve"] {
  return async (response: string) => {
    const failure = check(response);
    if (failure !== undefined) {
      throw new Error(failure);
    }

    return (context: FileReviewContext) => {
      context.setSection(sectionKey, response);
    };
  };
}

export function createStructuredTestStep(input: {
  stepId?: string;
  userMessage?: string;
  reviewProfile?: StepExecutionPlan["reviewProfile"];
  resolve?: StepExecutionPlan["resolve"];
}) {
  const stepId = input.stepId ?? "candidate-findings";

  return {
    stepId,
    prepare() {
      return {
        stepId,
        prompt: {
          systemMessage: "system prompt",
          userMessage: input.userMessage ?? "user prompt"
        },
        reviewProfile: input.reviewProfile ?? {
          knowledgeMode: "disabled",
          model: "gpt-5-mini",
          timeoutMs: REVIEW_TURN_TIMEOUT_MS
        },
        resolve: input.resolve ?? (async (_response: string, _services: StepResolveServices) => {
          return (context: FileReviewContext) => {
            context.setCandidateFindingsV3({
              result: "NO_FINDINGS",
              findings: [],
              hypothesisClosure: [],
              criticalMissingInformation: []
            });
          };
        })
      };
    }
  };
}

export const DEFAULT_CHECKED_SECTION_RESOLVE = makeSectionResolveWithDeterministicCheck(
  "summary",
  (response) =>
    /attempt 1/u.test(response) ? "deterministic completion failed" : undefined
);

export function runDefaultSectionStep(
  runner: StepRunner,
  context: ReturnType<typeof createStepRunnerContext>
) {
  return runner.run({
    step: createSectionTestStep({}),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });
}

export function runDefaultCheckedSectionStep(
  runner: StepRunner,
  context: ReturnType<typeof createStepRunnerContext>
) {
  return runner.run({
    step: createSectionTestStep({
      resolve: DEFAULT_CHECKED_SECTION_RESOLVE
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });
}

/**
 * Creates a minimal ReviewSessionFactoryLike that tracks each created
 * session and each sendAndWait call with per-session and per-send counters.
 * Tests use the hook callbacks to assert on call ordering, retry behaviour,
 * and early disconnects without needing a real Copilot connection.
 */
export function createReviewSessionFactory(input: {
  onCreateSession?: (profile: Parameters<ReviewSessionFactoryLike["createSession"]>[0], sessionIndex: number) => void;
  onSendAndWait: (call: {
    profile: Parameters<ReviewSessionFactoryLike["createSession"]>[0];
    prompt: string;
    timeoutMs?: number;
    sessionIndex: number;
    sendIndex: number;
  }) => string | undefined;
  onDisconnect?: (call: {
    profile: Parameters<ReviewSessionFactoryLike["createSession"]>[0];
    sessionIndex: number;
    sendCount: number;
  }) => void;
  onAbort?: (call: {
    profile: Parameters<ReviewSessionFactoryLike["createSession"]>[0];
    sessionIndex: number;
    sendCount: number;
  }) => void;
}): ReviewSessionFactoryLike {
  let sessionIndex = 0;

  return {
    async createSession(profile) {
      sessionIndex += 1;
      const currentSessionIndex = sessionIndex;
      input.onCreateSession?.(profile, currentSessionIndex);
      let sendIndex = 0;

      return new SessionExecutor({
        async sendAndWait(options, timeoutMs) {
          sendIndex += 1;
          const content = input.onSendAndWait({
            profile,
            prompt: options.prompt,
            timeoutMs,
            sessionIndex: currentSessionIndex,
            sendIndex
          });

          return {
            data: {
              content
            }
          };
        },
        async disconnect() {
          input.onDisconnect?.({
            profile,
            sessionIndex: currentSessionIndex,
            sendCount: sendIndex
          });
        },
        async abort() {
          input.onAbort?.({
            profile,
            sessionIndex: currentSessionIndex,
            sendCount: sendIndex
          });
        }
      });
    }
  };
}
