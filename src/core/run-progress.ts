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
      successfulFileCount: number;
      skippedFileCount: number;
    }
  | {
      type: "file-skipped";
      filePath: string;
      stepId: string;
      reason: string;
      successfulFileCount: number;
      skippedFileCount: number;
    }
  | {
      type: "run-finalizing";
      plannedFileCount: number;
      successfulFileCount: number;
      skippedFileCount: number;
    };

export type RunProgressEventHandler = (event: RunProgressEvent) => void;