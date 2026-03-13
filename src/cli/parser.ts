import type { RunRequest } from "../core/run-request.ts";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const USAGE = "review <base_ref> <head_ref> [--repo <path>] [--context <value>]";

export function parseReviewCommand(argv: string[]): RunRequest {
  const positionals = [];
  const userContext = [];
  let repoPath;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--repo") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new CliUsageError(`Missing value for --repo\nUsage: ${USAGE}`);
      }

      repoPath = value;
      index += 1;
      continue;
    }

    if (arg === "--context") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new CliUsageError(`Missing value for --context\nUsage: ${USAGE}`);
      }

      userContext.push(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new CliUsageError(`Unknown option: ${arg}\nUsage: ${USAGE}`);
    }

    positionals.push(arg);
  }

  if (positionals.length === 0) {
    throw new CliUsageError(`Missing required base_ref\nUsage: ${USAGE}`);
  }

  if (positionals.length === 1) {
    throw new CliUsageError(`Missing required head_ref\nUsage: ${USAGE}`);
  }

  const request: RunRequest = {
    baseRef: positionals[0],
    headRef: positionals[1],
    userContext
  };

  if (repoPath) {
    request.repoPath = repoPath;
  }

  return request;
}
