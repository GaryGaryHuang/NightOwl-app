import { JSON_STEP_SYSTEM_MESSAGE } from "./shared-step-system-blocks.ts";
import { normalizeChangesetEntriesForChangeMap } from "../change-map.ts";
import { buildXmlishJsonBlock } from "../prompt-serialization.ts";
import type { ReviewKnowledgeMode } from "../review-knowledge-mode.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import {
  formatReviewChangesetEntry,
  type ReviewChangesetEntry
} from "../../providers/review-source-provider.ts";

export const CHANGESET_OVERVIEW_REVIEW_PROFILE = {
  knowledgeMode: "built-in-context7",
  model: "gpt-5.4-mini",
  timeoutMs: REVIEW_TURN_TIMEOUT_MS
} as const satisfies {
  knowledgeMode: ReviewKnowledgeMode;
  model: string;
  timeoutMs: number;
};

export const CHANGESET_OVERVIEW_SYSTEM_MESSAGE = [
  JSON_STEP_SYSTEM_MESSAGE,
  "",
  "## Current Step: Changeset Overview",
  "- This is the run-level readiness step before per-file review begins.",
  "- Use this analysis sequence: read all run-level inputs, categorize affected scope, identify cross-file boundaries, extract observable behavior changes, and capture test-derived expectations.",
  "- For cross-file boundaries, check changed-file caller/callee links, shared contracts or DTO/schema/config formats, dependency-injection or wiring changes, persistence/shared-state or side effects, and changed tests that exercise production behavior.",
  "- When run-level inputs are insufficient to classify scope, cross-file boundaries, behavior changes, or test-derived expectations reliably, retrieve only the minimal additional context allowed by tool policy, then stop once the extra context no longer changes this overview.",
  "- Include only information that later per-file steps need; omit per-file detail, generic file-status summaries, and low-value restatements.",
  "- Group related files by changed area or interaction pattern instead of analyzing every file individually.",
  "- Preserve user-provided requirements, expected behavior, Root Cause, business decisions, and first-party background as review context for later steps.",
  "- If material context is unavailable, carry the limitation forward under the current step output contract instead of guessing.",
  "- Do not convert overview context into bug findings, risk verdicts, or final correctness conclusions."
].join("\n");

const CHANGESET_OVERVIEW_INSTRUCTION = [
  "Produce the Changeset Overview JSON object from the inputs above.",
  "",
  "Input contract:",
  "- `<changed_files_json>` is canonical. Use its normalized `entries[]` fields for `status`, `path`, deletion state, rename/copy metadata, and copied-as-added metadata.",
  "- `<changed_files>` is diagnostic raw name-status context only.",
  "- If `<user_context>` is present, map concrete reviewer-relevant facts into the appropriate output fields with enough specificity for downstream per-file review; do not reduce them to generic change summaries.",
  "",
  "Field separation rules:",
  "- Use `reviewObjective` and `userBehavior` for reviewer-facing goals, expected behavior, and user-observable or first-party behavior context; do not use them as generic file summaries.",
  "- Set `userBehavior.confidence` to `explicit` when the behavior is stated by the user and to `inferred` when changed tests or explicit code contracts establish expected behavior from observable evidence.",
  "- Use `behaviorChanges` for observable runtime, API, configuration, flow, or test-expectation changes tied to changed files.",
  "- Use `missingInformation` for material missing facts or open questions that affect review focus or interpretation.",
  "- Treat `overviewMarkdown` as a concise projection of the same high-signal context; do not introduce material context only in `overviewMarkdown` when a structured field should carry it.",
  "",
  "Entry rules:",
  "- For `behaviorChanges[]`, group files into one entry when they implement the same observable behavior; split entries only for distinct behavior, API, configuration, runtime flow, or test-expectation changes.",
  "- For `behaviorChanges[].files[]`, use normalized `path` values from `<changed_files_json>.entries`. For rename or copy entries, use `path`, not `previousPath`; for deleted entries, include `path` only when the deletion is part of the described behavior change.",
  "- Leave arrays empty when there is no high-signal content; do not create placeholder entries just to satisfy the shape.",
  "",
  "Required output top-level fields:",
  "- `reviewObjective`: `{ summary, requestedFocus, expectedBehaviorSummary }`, where `summary` is a non-empty string and `requestedFocus` and `expectedBehaviorSummary` are arrays of strings (empty arrays allowed).",
  "- `userBehavior`: array of `{ statement, confidence }`, where `confidence` is `explicit` or `inferred` (empty array allowed).",
  "- `behaviorChanges`: array of `{ description, files }` (empty array allowed).",
  "- `missingInformation`: array of `{ description, whyItMatters }` (empty array allowed).",
  "- `overviewMarkdown`: a JSON string value containing Markdown and starting with the exact prefix `## Changeset Overview` (no leading whitespace, no extra spaces inside the prefix). Use the four-bullet template below.",
  "",
  "Overview Markdown template:",
  "The `overviewMarkdown` JSON string value MUST follow this template:",
  "",
  "## Changeset Overview",
  "- Scope: [one or more labels from feature, bugfix, refactor, config, test, docs, plus a short changed area when useful]",
  "- Cross-file boundaries: [caller/callee relationships, shared contracts, configuration-to-runtime effects, or changed tests exercising production behavior that later per-file review needs; otherwise none]",
  "- Behavior changes: [observable runtime, API, configuration, flow, or test-expectation changes; otherwise none]",
  "- Test coverage observations: [corresponding changed test files plus the behavioral expectations or boundary conditions they reveal; otherwise no corresponding test changes observed]",
  "",
  "Minimal complete JSON example (illustrative only; values must reflect the actual changeset):",
  "",
  `{"reviewObjective": {"summary": "Review authentication redirect behavior across the changed request flow", "requestedFocus": ["redirect behavior"], "expectedBehaviorSummary": ["Unauthenticated users are redirected to the sign-in page"]}, "userBehavior": [{"statement": "Unauthenticated users are redirected to the sign-in page", "confidence": "inferred"}], "behaviorChanges": [{"description": "Unauthenticated requests now redirect to the sign-in page", "files": ["src/auth/redirect.ts"]}], "missingInformation": [], "overviewMarkdown": "## Changeset Overview\\n- Scope: feature\\n- Cross-file boundaries: src/auth/redirect.ts updates the redirect behavior used by authentication request handling\\n- Behavior changes: unauthenticated requests now redirect to the sign-in page\\n- Test coverage observations: no corresponding test changes observed"}`
].join("\n");

interface ChangesetOverviewPromptInput {
  changesetEntries: ReviewChangesetEntry[];
  userContext: string[];
}

export function buildChangesetOverviewPrompt(
  input: ChangesetOverviewPromptInput,
  validatorFeedback: unknown = null
): string {
  const promptLines = [
    ...buildXmlishJsonBlock("changed_files_json", {
      entries: normalizeChangesetEntriesForChangeMap(input.changesetEntries)
    }),
    "",
    "<changed_files>",
    input.changesetEntries.map(formatChangesetOverviewChangedFileEntry).join("\n"),
    "</changed_files>"
  ];

  if (input.userContext.length > 0) {
    promptLines.push(
      "",
      ...buildXmlishJsonBlock("user_context", { entries: input.userContext })
    );
  }

  promptLines.push(
    "",
    ...buildXmlishJsonBlock("validator_feedback", validatorFeedback),
    "",
    CHANGESET_OVERVIEW_INSTRUCTION
  );

  return promptLines.join("\n");
}

export function buildChangesetOverviewRetryRepairPrompt(
  input: ChangesetOverviewPromptInput,
  previousFailure: unknown
): string {
  return buildChangesetOverviewPrompt(
    input,
    {
      previousFailure,
      repairTask:
        "Regenerate the complete Changeset Overview JSON object after deterministic validation rejected the previous response.",
      correctionOrder: [
        "If previousFailure.code is PARSE, first make the response exactly one syntactically complete JSON object: remove Markdown fences, prose, duplicate root objects, trailing text, and incomplete JSON.",
        "If previousFailure.code is SCHEMA, fix the field indicated by previousFailure.message, previousFailure.offendingPath, previousFailure.allowedValues, or previousFailure.repairHint while preserving valid high-signal content.",
        "Re-check that the replacement object has the required top-level fields: reviewObjective, userBehavior, behaviorChanges, missingInformation, and overviewMarkdown."
      ],
      repairConstraints: [
        "Use the current changed_files_json and user_context blocks as the source inputs; validator_feedback is only error feedback, not review evidence.",
        "Preserve the source-backed review scope and user-provided expectations from the current inputs unless previousFailure shows a malformed field must be rewritten.",
        "Do not copy previousFailure messages, excerpts, diagnostics, or validator_feedback field names into the output object.",
        "Return a full replacement JSON object, not a patch, diff, explanation, or analysis note."
      ]
    }
  );
}

function formatChangesetOverviewChangedFileEntry(entry: ReviewChangesetEntry): string {
  if (entry.status === "C") {
    return `A\t${entry.path}`;
  }

  return formatReviewChangesetEntry(entry);
}
