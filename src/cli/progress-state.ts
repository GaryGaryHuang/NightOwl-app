import type { RunProgressEvent } from "../core/run-progress.ts";

interface ActiveFileState {
  claimOrder: number;
  lastProgressSeq: number;
}

export interface CliProgressState {
  activeFiles: Map<string, ActiveFileState>;
  eventSeq: number;
  plannedFileCount?: number;
  resolvedFiles: Set<string>;
  skippedFileCount: number;
  successfulFileCount: number;
}

export interface ProgressRenderInstruction {
  appendMessage?: string;
  renderProgress?: { significant: boolean };
}

export interface ProgressSnapshot {
  activeFileSummary: string;
  activeFileCount: number;
  plannedFileCount?: number;
  resolvedFileCount: number;
}

interface ProgressStateTransition {
  state: CliProgressState;
  warning?: string;
}

export function createInitialProgressState(): CliProgressState {
  return {
    activeFiles: new Map<string, ActiveFileState>(),
    eventSeq: 0,
    resolvedFiles: new Set<string>(),
    skippedFileCount: 0,
    successfulFileCount: 0
  };
}

export function reduceProgressEvent(
  current: CliProgressState,
  event: RunProgressEvent
): { state: CliProgressState; instruction: ProgressRenderInstruction } {
  switch (event.type) {
    case "run-initialized":
      return {
        state: {
          ...current,
          plannedFileCount: event.plannedFileCount
        },
        instruction: {
          appendMessage: `Output: ${event.outputTarget.basePath}`,
          renderProgress: { significant: true }
        }
      };

    case "file-claimed":
      return buildTransitionInstruction(
        withClaimedFile(current, event.filePath, event.claimOrder),
        { significant: false }
      );

    case "file-progressed":
      return buildTransitionInstruction(
        withProgressedFile(current, event.filePath),
        { significant: false }
      );

    case "file-completed":
      return buildTransitionInstruction(
        withResolvedOutcome(current, event.filePath, "completed"),
        { significant: true }
      );

    case "file-skipped":
      return buildTransitionInstruction(
        withResolvedOutcome(current, event.filePath, "skipped"),
        { significant: true },
        `Skipped: ${event.filePath} | ${event.stepId} | ${event.reason}`
      );

    case "run-finalizing":
      return {
        state: {
          ...current,
          plannedFileCount: event.plannedFileCount,
          skippedFileCount: event.skippedFileCount,
          successfulFileCount: event.successfulFileCount
        },
        instruction: {
          renderProgress: { significant: true }
        }
      };

    case "finalizer-failed":
      return {
        state: current,
        instruction: {
          appendMessage: `Finalizer failed: ${event.artifact} | ${event.message}`
        }
      };

    case "tool-audit-write-failed":
      return {
        state: current,
        instruction: {
          appendMessage: `Warning: ${event.message}`
        }
      };

    case "run-warning":
      return {
        state: current,
        instruction: {
          appendMessage: `Warning: ${event.message}`
        }
      };

    case "review-session-log":
      return {
        state: current,
        instruction: {
          appendMessage: `Review diagnostic: ${event.stepId} | ${event.message}`
        }
      };

    default: {
      const unsupportedEvent: never = event;
      const eventType = String((unsupportedEvent as { type?: unknown }).type);
      return {
        state: current,
        instruction: {
          appendMessage: progressContractWarning(
            `ignored unsupported progress event type: ${eventType}`
          )
        }
      };
    }
  }
}

function withClaimedFile(
  current: CliProgressState,
  filePath: string,
  claimOrder: number
): ProgressStateTransition {
  if (current.activeFiles.has(filePath)) {
    return {
      state: current,
      warning: progressContractWarning(
        `ignored duplicate claim for active file "${filePath}"`
      )
    };
  }

  if (current.resolvedFiles.has(filePath)) {
    return {
      state: current,
      warning: progressContractWarning(
        `ignored claim for already resolved file "${filePath}"`
      )
    };
  }

  const activeFiles = new Map(current.activeFiles);
  const nextEventSeq = current.eventSeq + 1;

  activeFiles.set(filePath, {
    claimOrder,
    lastProgressSeq: nextEventSeq
  });

  return {
    state: {
      ...current,
      activeFiles,
      eventSeq: nextEventSeq
    }
  };
}

function withProgressedFile(
  current: CliProgressState,
  filePath: string
): ProgressStateTransition {
  const existing = current.activeFiles.get(filePath);

  if (!existing) {
    return {
      state: current,
      warning: progressContractWarning(
        `ignored progress for non-active file "${filePath}"`
      )
    };
  }

  const activeFiles = new Map(current.activeFiles);
  const nextEventSeq = current.eventSeq + 1;

  activeFiles.set(filePath, {
    claimOrder: existing.claimOrder,
    lastProgressSeq: nextEventSeq
  });

  return {
    state: {
      ...current,
      activeFiles,
      eventSeq: nextEventSeq
    }
  };
}

function withResolvedOutcome(
  current: CliProgressState,
  filePath: string,
  outcome: "completed" | "skipped"
): ProgressStateTransition {
  if (!current.activeFiles.has(filePath)) {
    return {
      state: current,
      warning: progressContractWarning(
        `ignored ${outcome} for non-active file "${filePath}"`
      )
    };
  }

  const activeFiles = new Map(current.activeFiles);
  const resolvedFiles = new Set(current.resolvedFiles);
  activeFiles.delete(filePath);
  resolvedFiles.add(filePath);

  return {
    state: {
      ...current,
      activeFiles,
      resolvedFiles,
      successfulFileCount: current.successfulFileCount + (outcome === "completed" ? 1 : 0),
      skippedFileCount: current.skippedFileCount + (outcome === "skipped" ? 1 : 0)
    }
  };
}

export function createProgressSnapshot(state: CliProgressState): ProgressSnapshot {
  return {
    activeFileSummary: buildActiveFileSummary(state.activeFiles),
    activeFileCount: state.activeFiles.size,
    plannedFileCount: state.plannedFileCount,
    resolvedFileCount: state.successfulFileCount + state.skippedFileCount
  };
}

function buildActiveFileSummary(
  activeFiles: Map<string, ActiveFileState>
): string {
  const orderedFiles = [...activeFiles.entries()]
    .sort((left, right) => {
      if (left[1].lastProgressSeq !== right[1].lastProgressSeq) {
        return right[1].lastProgressSeq - left[1].lastProgressSeq;
      }

      if (left[1].claimOrder !== right[1].claimOrder) {
        return left[1].claimOrder - right[1].claimOrder;
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([filePath]) => filePath);

  const visibleFiles = orderedFiles.slice(0, 3);
  const hiddenCount = Math.max(0, orderedFiles.length - visibleFiles.length);
  const visibleSummary = visibleFiles.join(", ");

  if (!visibleSummary) {
    return "";
  }

  return hiddenCount > 0
    ? `${visibleSummary} | +${hiddenCount} more`
    : visibleSummary;
}

function buildTransitionInstruction(
  transition: ProgressStateTransition,
  renderProgress?: { significant: boolean },
  appendMessage?: string
): { state: CliProgressState; instruction: ProgressRenderInstruction } {
  const messages = [appendMessage, transition.warning].filter(
    (message): message is string => Boolean(message)
  );

  return {
    state: transition.state,
    instruction: {
      appendMessage: messages.length > 0 ? messages.join("\n") : undefined,
      renderProgress: transition.warning ? undefined : renderProgress
    }
  };
}

function progressContractWarning(message: string): string {
  return `Warning: CliProgressReporter ${message}`;
}
