import type { OutputTarget } from "./review-path-resolver.ts";

export type RunProgressEvent =
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
      artifact: "index";
      message: string;
    }
  | {
      type: "tool-audit-write-failed";
      message: string;
    }
  | {
      type: "run-warning";
      message: string;
    }
  | {
      type: "review-session-log";
      stepId: string;
      message: string;
    };

export type RunProgressEventHandler = (event: RunProgressEvent) => void;
