import type { RunRequest } from "../core/run-request.ts";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const REVIEW_RUN_USAGE =
  "review <base_ref> <head_ref> [--repo <path>] [--context <value>] [--dry-run]";
const CHECK_USAGE = "review --check";
const USAGE = `${REVIEW_RUN_USAGE}\n${CHECK_USAGE}`;

export type ParsedReviewCommand =
  | { kind: "check" }
  | { kind: "run"; request: RunRequest };

interface ParsedRunTokens {
  positionals: string[];
  userContext: string[];
  repoPath?: string;
  dryRun: boolean;
}

/**
 * Parse the review command into the RunRequest consumed by the app layer.
 */
export function parseReviewCommand(argv: string[]): ParsedReviewCommand {
  if (isCheckMode(argv)) {
    return { kind: "check" };
  }

  return {
    kind: "run",
    request: buildRunRequest(validateRunTokens(scanRunTokens(argv)))
  };
}

function isCheckMode(argv: string[]): boolean {
  return argv.includes("--check");
}

function scanRunTokens(argv: string[]): ParsedRunTokens {
  const tokens: ParsedRunTokens = {
    positionals: [],
    userContext: [],
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--repo": {
        const value = readOptionValue(argv, index, "--repo");
        tokens.repoPath = value;
        index += 1;
        break;
      }

      case "--dry-run":
        tokens.dryRun = true;
        break;

      case "--context": {
        const value = readOptionValue(argv, index, "--context");
        tokens.userContext.push(value);
        index += 1;
        break;
      }

      default:
        if (arg.startsWith("--")) {
          throw usageError(`Unknown option: ${arg}`);
        }

        tokens.positionals.push(arg);
        break;
    }
  }

  return tokens;
}

function readOptionValue(
  argv: string[],
  index: number,
  optionName: "--repo" | "--context"
): string {
  const value = argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw usageError(`Missing value for ${optionName}`);
  }

  return value;
}

function validateRunTokens(tokens: ParsedRunTokens): ParsedRunTokens {
  const { positionals } = tokens;

  if (positionals.length === 0) {
    throw usageError("Missing required base_ref");
  }

  if (positionals.length === 1) {
    throw usageError("Missing required head_ref");
  }

  if (positionals.length > 2) {
    throw usageError(`Unexpected positional input: ${positionals[2]}`);
  }

  return tokens;
}

function buildRunRequest(tokens: ParsedRunTokens): RunRequest {
  const request: RunRequest = {
    baseRef: tokens.positionals[0],
    headRef: tokens.positionals[1],
    userContext: tokens.userContext,
    dryRun: tokens.dryRun
  };

  if (tokens.repoPath) {
    request.repoPath = tokens.repoPath;
  }

  return request;
}

function usageError(message: string): CliUsageError {
  return new CliUsageError(`${message}\nUsage: ${USAGE}`);
}
