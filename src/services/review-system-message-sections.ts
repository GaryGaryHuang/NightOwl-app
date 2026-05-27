// This module pins the Copilot SDK system-prompt section names that NightOwl's
// review sessions opt to remove (vs. keep) when running in `customize` mode.
//
// Source of truth: the `SystemMessageSection` string-literal union exported by
// `@github/copilot-sdk` (see `dist/types.d.ts`). The `satisfies` clauses below
// ensure every name here is a valid SDK section at compile time. If the SDK
// renames or removes a section, the build fails. If the SDK *adds* a section,
// the contract test in `test/services/review-system-message-sections.test.ts`
// fails — forcing a deliberate decision to remove or keep the new section.
// Without that guard, review prompts would silently start including
// unintended SDK-managed content on an SDK upgrade.

import type { SystemMessageSection } from "@github/copilot-sdk";

/** SDK-managed sections the review session strips from the system prompt. */
export const REVIEW_REMOVED_SDK_SECTIONS = [
  "identity",
  "tone",
  "tool_efficiency",
  "code_change_rules",
  "guidelines",
  "tool_instructions",
  "custom_instructions",
  "last_instructions"
] as const satisfies readonly SystemMessageSection[];

/** SDK-managed sections intentionally retained in the review system prompt. */
export const REVIEW_KEPT_SDK_SECTIONS = [
  "environment_context",
  "runtime_instructions",
  "safety"
] as const satisfies readonly SystemMessageSection[];

export type ReviewRemovedSdkSection = (typeof REVIEW_REMOVED_SDK_SECTIONS)[number];
export type ReviewKeptSdkSection = (typeof REVIEW_KEPT_SDK_SECTIONS)[number];

type RemoveAction = { readonly action: "remove" };

/**
 * Build the `sections` object literal passed to the SDK's `customize` system
 * message mode, with `{ action: "remove" }` for every entry in
 * `REVIEW_REMOVED_SDK_SECTIONS`. Derived from the constant so the two cannot
 * drift.
 */
export function buildRemoveAllSectionsConfig(): Readonly<
  Record<ReviewRemovedSdkSection, RemoveAction>
> {
  const entries = REVIEW_REMOVED_SDK_SECTIONS.map(
    (name) => [name, { action: "remove" } as const] as const
  );
  return Object.fromEntries(entries) as Record<
    ReviewRemovedSdkSection,
    RemoveAction
  >;
}
