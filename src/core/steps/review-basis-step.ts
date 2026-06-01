import type { FileReviewContext } from "../file-review-context.ts";
import {
  ReviewBasisValidator,
  type ReviewBasisValidationResult
} from "../review-basis-validator.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import type { RunContext } from "../run-context.ts";
import type { StepDefinition, StepExecutionPlan } from "../step-runner.ts";
import { buildXmlishJsonBlock } from "../prompt-serialization.ts";
import { REVIEW_BASIS_STEP_ID } from "../review-step-ids.ts";
import {
  JSON_STEP_SYSTEM_MESSAGE,
  MISSING_INFORMATION_DISCIPLINE_BLOCK
} from "./shared-step-system-blocks.ts";

const REVIEW_BASIS_SYSTEM_ADDITION = [
  "## Current Step: ReviewBasis",
  "- This is the per-file evidence-basis step. Build the structured context that Candidate Findings and Semantic Validation will use for this file.",
  "- Do not produce bug findings, risk verdicts, or final correctness conclusions in this step.",
  "- Before writing the JSON, follow this execution order: identify this file's role from `<change_map>`, use `<diff>` and retrieved repository evidence to ground file-level behavior and evidence, separate observed facts from bounded inferences, decide whether any evidence-backed validation target belongs in `hypothesisLedger`, then emit the ReviewBasis JSON object.",
  "- Before using `missingInformation` or leaving `hypothesisLedger` empty for a repo-local question, inspect likely local counterparts that could answer it: concrete implementations, call sites, dependency injection wiring, DTO/domain mappers, downstream consumers, interface contracts, and changed or adjacent tests.",
  "- Treat `<change_map>` as authoritative run-level review context, but ground this file's basis in the reviewed diff and retrieved repository evidence.",
  "- Include only distinct signals needed for downstream review; omit generic file summaries, repeated facts, and low-signal speculation.",
  "- Treat `hypothesisLedger` as a queue of testable downstream validation targets, not assumed defects.",
  "- Add a hypothesis only when evidence points to a concrete behavior, contract, reachability, impact, or regression question that later steps can validate.",
  "- Prefer an empty `hypothesisLedger` over a weak or speculative hypothesis when this file has no evidence-backed validation target.",
  "- If a material fact is still unavailable after the Missing Information Discipline checks, record it under the current step output contract instead of guessing or turning it into a hypothesis.",
  "- If `<retry_repair_context>` is appended, treat it only as deterministic validation feedback; regenerate the complete ReviewBasis JSON for the same `<change_map>` and `<diff>`, fixing the named parse/schema issue without adding unrelated breadth."
].join("\n");

const REVIEW_BASIS_INSTRUCTION = [
  "Produce the ReviewBasis JSON object for this file from the inputs above.",
  "",
  "Input contract:",
  "- `<change_map>` is authoritative run-level review context. Use it for intended changeset behavior, user context, and this file's role; do not treat it as file-level proof by itself.",
  "- `<diff>` is the canonical reviewed-file change input. Ground changed behavior and reviewed-file facts in the diff or retrieved repository evidence.",
  "- Retrieve enough repository context when it is needed or likely to materially improve evidence precision for a ReviewBasis field or downstream validation target.",
  "- Stop retrieving when additional context would only add background detail, confidence-only nuance, repeated evidence, or information that would not change the ReviewBasis fields, hypothesis decision, or missing-information decision.",
  "",
  "Field separation rules:",
  "- Use `roleInChangeset` for this file's role in the changeset, not a generic file summary.",
  "- Use `changedBehavior` for before/after observable behavior changes supported by `E*` evidence.",
  "- Use `facts` for direct observations from the diff or retrieved code; use `inferences` for bounded conclusions based on cited evidence and include `confidence`.",
  "- Set inference `confidence` to `high` only when cited evidence directly establishes the conclusion; use `low` when the evidence supports a possible review implication that downstream validation must still prove.",
  "- Use `dependencyMap` and `flowMap` for compact map signals. If one materially supports a hypothesis or downstream judgment, mirror it in `facts` or `inferences` with `E*` evidence.",
  "- Treat changed tests or relevant repository tests as evidence only when they define expected behavior, contract, trigger, reachability, impact, or a downstream validation target; record material test-derived signals in `facts` or `inferences` with `E*` evidence.",
  "- Use `hypothesisLedger` as the downstream validation queue, not a defect list. Each `triggerCondition` must name the concrete code path, input, state, or runtime condition later steps can test.",
  "- If local evidence leaves an unresolved but material correctness, reachability, impact, or contract question that downstream steps can still test from repo context, add a low-confidence `inferences` entry and an `H*` hypothesis instead of `missingInformation` or an empty `hypothesisLedger`.",
  "- Use `missingInformation` only when all three of the following hold: (a) allowed local checks and permitted external retrieval cannot resolve the fact; (b) downstream validation cannot test the question locally; (c) the unresolved fact would change a ReviewBasis field, `hypothesisLedger`, a downstream Candidate Findings or Semantic Validation target, or final must/nice-to-have classification.",
  "- Use `evidenceRefs` only for evidence cited by high-signal `changedBehavior`, `facts`, or `inferences` entries.",
  "",
  "Entry construction rules:",
  "- Build `evidenceRefs` first, then populate changed behavior, facts, inferences, dependency maps, and flow maps.",
  "- Add `H*` entries only for distinct evidence-backed validation targets that later steps can test from the diff, ReviewBasis evidence, or retrieved repository context; otherwise keep `hypothesisLedger` empty.",
  "- Compact means merge duplicate targets and shorten strings; do not omit a separate evidence-backed validation target solely because its expected severity is low, if it has a distinct trigger, contract, reachability path, or impact.",
  "- Use stable IDs: `E1`, `E2`, ... for `evidenceRefs[].evidenceId`; `H1`, `H2`, ... for `hypothesisLedger[].hypothesisId`.",
  "- Every `evidenceIds` or `basedOnEvidenceIds` value must reference an ID defined in `evidenceRefs`.",
  "- Leave arrays empty when there is no high-signal content; merge duplicates and omit filler, weak speculation, confidence-only gaps, and ordinary coverage gaps.",
  "",
  "Required output top-level fields:",
  "- `roleInChangeset`: this file's specific role in the changeset.",
  "- `evidenceRefs`: array of `{ evidenceId, sourceType, location, summary }`.",
  "- `changedBehavior`: array of `{ before, after, evidenceIds }`, where `evidenceIds` reference `E*` evidence IDs.",
  "- `facts`: array of `{ statement, evidenceIds }`, where `evidenceIds` reference `E*` evidence IDs.",
  "- `inferences`: array of `{ statement, basedOnEvidenceIds, confidence }`, where `basedOnEvidenceIds` reference `E*` evidence IDs and confidence is `high` or `low`.",
  "- `dependencyMap`: `{ upstreamCallers, downstreamConsumers, externalContracts, sharedStateOrSideEffects }` (sub-fields may be empty arrays).",
  "- `flowMap`: `{ entryPoints, stateTransitions, asyncBoundaries, errorPaths }` (sub-fields may be empty arrays).",
  "- `hypothesisLedger`: array of `{ hypothesisId, statement, triggerCondition }`, where `hypothesisId` uses `H*` IDs.",
  "- `missingInformation`: array of `{ description, whyItMatters }`.",
  "",
  "Sub-field rules:",
  "- `evidenceRefs.sourceType`: use `diff` for reviewed diff evidence, `repo_file` for retrieved repository context, `test` for test-derived expected behavior, `contract` for explicit API/config/first-party contracts, and `change_map` for run-level context; do not invent tool transcript labels.",
  "- `evidenceRefs.location`: use a repo path plus line, symbol, or hunk when available; for run-level context use the source block name; do not invent exact line numbers when only a symbol or hunk is available.",
  "- `evidenceRefs.summary`: summarize only the cited evidence, not the conclusion it supports.",
  "- `dependencyMap.upstreamCallers`: current repo callers, entry components, or changed files that reach this file's changed behavior.",
  "- `dependencyMap.downstreamConsumers`: code, outputs, state, or contracts that consume this file's changed result.",
  "- `dependencyMap.externalContracts`: explicit API, SDK, config/schema, wire/storage format, user-visible, or first-party behavior contracts that constrain expected behavior; omit generic product goals or ordinary behavior summaries.",
  "- `dependencyMap.sharedStateOrSideEffects`: material shared mutable state, persistence, cache, UI state, network/IO, logging/metrics, or concurrency/lifecycle side effects that can affect behavior, reachability, impact, or validation; omit local temporaries and incidental logging/metrics.",
  "- `flowMap.entryPoints`: concrete current repo-supported functions, handlers, lifecycle methods, routes, hooks, or command paths that enter or expose this file's changed flow.",
  "- `flowMap.stateTransitions`: material data, control, lifecycle, or state transitions in the reviewed flow; omit restating `changedBehavior` unless the transition is needed for reachability or validation.",
  "- `flowMap.asyncBoundaries`: callbacks, promises, tasks, threads, timers, lifecycle boundaries, or cancellation points only when ordering, lifetime, concurrency, or cancellation affects the changed behavior or validation target.",
  "- `flowMap.errorPaths`: material fallback, exception, null/empty, validation failure, early return, or recovery paths touched by the change or needed for downstream validation; omit generic error paths not on the reviewed flow.",
  "",
  "Minimal complete JSON example (illustrative only; values must reflect the actual reviewed file):",
  `{"roleInChangeset":"Changes request validation so invalid input exits before downstream processing.","evidenceRefs":[{"evidenceId":"E1","sourceType":"diff","location":"src/handler.ts:RequestHandler.handle","summary":"Changed validation branch returns before processInput runs."},{"evidenceId":"E2","sourceType":"test","location":"test/handler.test.ts:invalid input case","summary":"Changed test defines the expected failure result for invalid input."}],"changedBehavior":[{"before":"Invalid input continued to downstream processing.","after":"Invalid input returns before downstream processing.","evidenceIds":["E1"]}],"facts":[{"statement":"The changed branch returns before calling processInput when validation fails.","evidenceIds":["E1"]},{"statement":"The changed test defines the expected failure result for invalid input.","evidenceIds":["E2"]}],"inferences":[{"statement":"Downstream validation should verify callers still receive the expected failure result for invalid input.","basedOnEvidenceIds":["E1","E2"],"confidence":"low"}],"dependencyMap":{"upstreamCallers":["RequestHandler.handle reaches the changed validation branch."],"downstreamConsumers":["processInput consumes validated input."],"externalContracts":[],"sharedStateOrSideEffects":[]},"flowMap":{"entryPoints":["RequestHandler.handle"],"stateTransitions":["input received -> validation failure -> early return"],"asyncBoundaries":[],"errorPaths":["validation failure"]},"hypothesisLedger":[{"hypothesisId":"H1","statement":"Validate whether invalid input still produces the expected failure result after the early return.","triggerCondition":"validation fails before processInput is called"}],"missingInformation":[]}`
].join("\n");

interface ReviewBasisStepOptions {
  runContext: RunContext;
  validator?: Pick<ReviewBasisValidator, "validate">;
}

export class ReviewBasisStep implements StepDefinition {
  readonly stepId = REVIEW_BASIS_STEP_ID;
  readonly #runContext: RunContext;
  readonly #validator: Pick<ReviewBasisValidator, "validate">;

  constructor(options: ReviewBasisStepOptions) {
    this.#runContext = options.runContext;
    this.#validator = options.validator ?? new ReviewBasisValidator();
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    return {
      stepId: this.stepId,
      prompt: {
        systemMessage: [
          JSON_STEP_SYSTEM_MESSAGE,
          MISSING_INFORMATION_DISCIPLINE_BLOCK.content,
          REVIEW_BASIS_SYSTEM_ADDITION
        ].join("\n\n"),
        userMessage: buildReviewBasisUserMessage(context, this.#runContext)
      },
      reviewProfile: {
        knowledgeMode: "built-in-context7",
        model: "gpt-5.4-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
      },
      resolve: async (response) => {
        return this.#resolveValidatedReviewBasis(response, context);
      }
    };
  }

  #resolveValidatedReviewBasis(
    response: string,
    context: FileReviewContext
  ): Promise<(context: FileReviewContext) => void> {
    const result: ReviewBasisValidationResult = this.#validator.validate({
      responseText: response,
      filePath: context.filePath
    });
    if (!result.ok) {
      throw new Error(
        `ReviewBasis validation failed: ${result.diagnostics.map((d) => d.message).join("; ")}`
      );
    }
    const reviewBasis = result.value;
    return Promise.resolve((targetContext: FileReviewContext) => {
      targetContext.setReviewBasis(reviewBasis);
    });
  }
}

function buildReviewBasisUserMessage(
  context: FileReviewContext,
  runContext: RunContext
): string {
  return [
    ...buildXmlishJsonBlock("change_map", runContext.changesetOverview),
    "",
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    REVIEW_BASIS_INSTRUCTION
  ].join("\n");
}
