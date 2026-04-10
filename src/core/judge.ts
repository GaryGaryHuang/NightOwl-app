import type { JudgeSessionFactory } from "../services/judge-session-factory.ts";

export interface JudgeEvaluationInput {
  stepId: string;
  filePath: string;
  criteria: string;
  sectionContent: string;
}

export interface JudgeEvaluationResult {
  passed: boolean;
  cause?: "judge rejected";
}

export interface JudgeServiceOptions {
  judgeSessionFactory: Pick<JudgeSessionFactory, "createSession">;
}

/**
 * Run the dedicated completion-check session for section steps and normalize its Y/N response.
 */
export class JudgeService {
  readonly #systemMessage = [
    "You are a completion checker. Evaluate whether the content in <section> satisfies the requirements explicitly listed in <criteria>.",
    "",
    "General Rules:",
    "- Check the requirements in <criteria> one by one.",
    "- Judge only against the requirements explicitly stated in <criteria>. Do not add stricter standards of your own.",
    "- Treat a field as valid if it is present and provides a meaningful response to the required item. Concise answers are acceptable if they directly satisfy the requirement.",
    "- If a requirement explicitly allows a negative, none, or not-applicable style answer (e.g., \"無\", \"無外部相依\"), treat that response as valid.",
    "- A field fails only if it is missing, blank, clearly unreplaced placeholder text (e.g., \"[the file's primary role]\"), or does not answer the required item at all.",
    "- Minor formatting variations (e.g., bullet style, heading level, whitespace) do not constitute a failure as long as the required content is present and meaningful.",
    "- Do not use outside knowledge. Judge only from <section> and <criteria>.",
    "- If any requirement is not met or cannot be verified from <section>, output N.",
    "",
    "Output Y only if every requirement is satisfied.",
    "Output N otherwise.",
    "Output only Y or N — no other text or explanation."
  ].join("\n");

  readonly #judgeSessionFactory: Pick<JudgeSessionFactory, "createSession">;

  constructor(options: JudgeServiceOptions) {
    this.#judgeSessionFactory = options.judgeSessionFactory;
  }

  async evaluate(input: JudgeEvaluationInput): Promise<JudgeEvaluationResult> {
    let session;

    try {
      session = await this.#judgeSessionFactory.createSession({
        model: "gpt-5-mini",
        systemMessage: this.#systemMessage
      });
    } catch {
      throw new Error("judge startup failed");
    }

    let response: string | undefined;

    try {
      response = await session.sendAndWait(
        buildJudgePrompt(input),
        180_000
      );
    } catch {
      throw new Error("judge timeout");
    }

    // Keep the acceptance check intentionally narrow: only y/yes counts as pass.
    const normalized = response?.trim().toLowerCase();

    if (normalized === "y" || normalized === "yes") {
      return { passed: true };
    }

    return {
      passed: false,
      cause: "judge rejected"
    };
  }
}

function buildJudgePrompt(input: JudgeEvaluationInput): string {
  return [
    "Evaluate whether <section> satisfies all requirements in <criteria>.",
    "Return `Y` if all requirements are satisfied.",
    "Return `N` otherwise.",
    "",
    "<section>",
    input.sectionContent,
    "</section>",
    "",
    "<criteria>",
    input.criteria,
    "</criteria>"
  ].join("\n");
}
