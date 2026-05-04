import type {
  ChangeMapReadiness,
  ExpectedChangedFileDescriptor
} from "./change-map.ts";

export interface RunContext {
  /**
   * Step 0's structured artifact. Validated and deep-frozen
   * upstream by `Step0OutputValidator`; consumers MUST treat it as read-only.
   */
  readonly changesetOverview: ChangeMapReadiness;
  /**
   * Trailing-`\n` normalized projection of `changesetOverview.overviewMarkdown`
   * for downstream prompts/sinks. Always ends with exactly one `\n` whenever
    * the source `overviewMarkdown` is non-empty. The underlying Step 0 V2 artifact is
   * never mutated — its deep-frozen contract is preserved.
   */
  readonly changesetOverviewMarkdown: string;
  readonly userContext: readonly string[];
  readonly changesetFiles: readonly ExpectedChangedFileDescriptor[];
}

/**
 * Build the immutable run-level context shared from Step 0 into each per-file review.
 *
 * Invariant: `changesetOverviewMarkdown` always ends with `\n`. If
 * `changesetOverview.overviewMarkdown` does not end with one, a single `\n` is appended
 * for the projection only; the source Step 0 V2 artifact is left untouched.
 */
export function createRunContext(input: {
  changesetOverview: ChangeMapReadiness;
  userContext: readonly string[];
  changesetFiles?: readonly ExpectedChangedFileDescriptor[];
}): RunContext {
  const overviewMarkdown = input.changesetOverview.overviewMarkdown;
  const changesetOverviewMarkdown = overviewMarkdown.endsWith("\n")
    ? overviewMarkdown
    : overviewMarkdown + "\n";

  return Object.freeze({
    changesetOverview: input.changesetOverview,
    changesetOverviewMarkdown,
    userContext: Object.freeze([...input.userContext]),
    changesetFiles: Object.freeze([...(input.changesetFiles ?? [])])
  });
}
