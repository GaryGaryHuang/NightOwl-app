export interface RunContext {
  readonly changesetOverview: string;
  readonly userContext: readonly string[];
}

export function createRunContext(input: {
  changesetOverview: string;
  userContext: string[];
}): RunContext {
  return Object.freeze({
    changesetOverview: input.changesetOverview,
    userContext: Object.freeze([...input.userContext])
  });
}
