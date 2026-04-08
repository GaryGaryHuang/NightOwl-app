export interface RunContext {
  readonly changesetOverview: string;
  readonly userContext: readonly string[];
}

/**
 * Build the immutable run-level context shared from Step 0 into each per-file review.
 *
 * Invariant: `changesetOverview` always ends with `\n`. If the raw input does not
 * end with one, a single `\n` is appended before the value is frozen. This
 * normalization is part of the RunContext construction contract; callers must not
 * normalize before calling this function.
 */
export function createRunContext(input: {
  changesetOverview: string;
  userContext: string[];
}): RunContext {
  const changesetOverview = input.changesetOverview.endsWith("\n")
    ? input.changesetOverview
    : input.changesetOverview + "\n";

  return Object.freeze({
    changesetOverview,
    userContext: Object.freeze([...input.userContext])
  });
}
