export interface RunContext {
  readonly changesetOverview: string;
  readonly userContext: readonly string[];
}

/**
 * Build the immutable run-level context shared from Step 0 into each per-file review.
 */
export function createRunContext(input: {
  changesetOverview: string;
  userContext: string[];
}): RunContext {
  return Object.freeze({
    changesetOverview: input.changesetOverview,
    userContext: Object.freeze([...input.userContext])
  });
}
