import type { ChangeMap } from "./change-map.ts";

export interface RunContext {
  /**
   * Step 0's structured artifact (`ChangeMap` v1). Validated and deep-frozen
   * upstream by `Step0OutputValidator`; consumers MUST treat it as read-only.
   */
  readonly changesetOverview: ChangeMap;
  /**
   * Trailing-`\n` normalized projection of `changesetOverview.overviewMarkdown`
   * for downstream prompts/sinks. Always ends with exactly one `\n` whenever
   * the source `overviewMarkdown` is non-empty. The underlying `ChangeMap` is
   * never mutated — its deep-frozen contract is preserved.
   */
  readonly changesetOverviewMarkdown: string;
  readonly userContext: readonly string[];
}

/**
 * Build the immutable run-level context shared from Step 0 into each per-file review.
 *
 * Invariant: `changesetOverviewMarkdown` always ends with `\n`. If
 * `ChangeMap.overviewMarkdown` does not end with one, a single `\n` is appended
 * for the projection only; the source `ChangeMap` is left untouched.
 */
export function createRunContext(input: {
  changesetOverview: ChangeMap;
  userContext: readonly string[];
}): RunContext {
  const overviewMarkdown = input.changesetOverview.overviewMarkdown;
  const changesetOverviewMarkdown = overviewMarkdown.endsWith("\n")
    ? overviewMarkdown
    : overviewMarkdown + "\n";

  return Object.freeze({
    changesetOverview: input.changesetOverview,
    changesetOverviewMarkdown,
    userContext: Object.freeze([...input.userContext])
  });
}
