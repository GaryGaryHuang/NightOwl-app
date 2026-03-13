import type { RunRequest } from "../core/run-request.ts";

export interface ReviewAppResult {
  message: string;
}

export interface ReviewApp {
  run(request: RunRequest): Promise<ReviewAppResult>;
}

export const FOUNDATION_PLACEHOLDER_MESSAGE =
  "NightOwl foundation: review workflow is not implemented yet.";

export function createFoundationPlaceholderApp(): ReviewApp {
  return {
    async run(_request: RunRequest): Promise<ReviewAppResult> {
      return {
        message: FOUNDATION_PLACEHOLDER_MESSAGE
      };
    }
  };
}
