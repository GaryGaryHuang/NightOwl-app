import type { OutputTarget } from "./review-path-resolver.ts";

export type ReviewRunPhase = "step0" | "planning" | "reviewing";

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
      artifact: "summary" | "index" | "verifier-report" | "manifest";
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
