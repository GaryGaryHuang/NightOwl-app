import type { OutputTarget } from "./review-path-resolver.ts";

import { CHANGESET_OVERVIEW_STEP_ID } from "./review-step-ids.ts";

export type ReviewRunPhase = typeof CHANGESET_OVERVIEW_STEP_ID | "planning" | "reviewing";

export type RunProgressEvent =
  | {
      type: "phase-changed";
      phase: ReviewRunPhase;
    }
  | {
      type: "run-initialized";
      repoRoot: string;
      outputTarget: OutputTarget;
      plannedFileCount: number;
    }
  | {
      type: "file-claimed";
      filePath: string;
      claimOrder: number;
    }
  | {
      type: "file-progressed";
      filePath: string;
      stepId: string;
    }
  | {
      type: "file-completed";
      filePath: string;
    }
  | {
      type: "file-skipped";
      filePath: string;
      stepId: string;
      reason: string;
    }
  | {
      type: "run-finalizing";
      plannedFileCount: number;
      successfulFileCount: number;
      skippedFileCount: number;
    }
  | {
      type: "finalizer-failed";
      artifact: "summary" | "index";
      message: string;
    }
  | {
      type: "tool-audit-write-failed";
      message: string;
    }
  | {
      type: "review-session-log";
      stepId: string;
      message: string;
    };

export type RunProgressEventHandler = (event: RunProgressEvent) => void;
