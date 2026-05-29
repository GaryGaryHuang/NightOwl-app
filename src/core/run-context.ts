import type { ChangeMapReadiness } from "./change-map.ts";

export interface RunContext {
  /**
   * Changeset Overview's structured artifact. Validated and deep-frozen
   * upstream by `ChangesetOverviewOutputValidator`; consumers MUST treat it as read-only.
   */
  readonly changesetOverview: ChangeMapReadiness;
  /**
   * Trailing-`\n` normalized projection of `changesetOverview.overviewMarkdown`
   * for downstream prompts/sinks. Always ends with exactly one `\n` whenever
   * the source `overviewMarkdown` is non-empty. The underlying Changeset Overview artifact is
   * never mutated — its deep-frozen contract is preserved.
   */
  readonly changesetOverviewMarkdown: string;
  readonly userContext: readonly string[];
}

/**
 * Build the immutable run-level context shared from Changeset Overview into each per-file review.
 *
 * Invariant: `changesetOverviewMarkdown` always ends with `\n`. If
 * `changesetOverview.overviewMarkdown` does not end with one, a single `\n` is appended
 * for the projection only; the source Changeset Overview artifact is left untouched.
 */
export function createRunContext(input: {
  changesetOverview: ChangeMapReadiness;
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
