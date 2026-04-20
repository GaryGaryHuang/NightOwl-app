import type { RunProgressEvent } from "../core/run-progress.ts";

const CLEAR_LINE = "\u001b[2K\r";

export interface CliProgressStdout {
  isTTY?: boolean;
  columns?: number;
  log(message: unknown): void;
  write?(chunk: string): boolean;
}

interface ActiveFileState {
  claimOrder: number;
  lastProgressSeq: number;
}

interface CliProgressState {
  activeFiles: Map<string, ActiveFileState>;
  eventSeq: number;
  plannedFileCount?: number;
  resolvedFiles: Set<string>;
  skippedFileCount: number;
  successfulFileCount: number;
}

interface CliSurfaceState {
  hasLiveLine: boolean;
}

interface ProgressRenderInstruction {
  appendMessage?: string;
  renderProgress?: { significant: boolean };
}

interface ProgressSnapshot {
  activeFileSummary: string;
  activeFileCount: number;
  plannedFileCount?: number;
  resolvedFileCount: number;
}

class CliProgressRenderer {
  readonly #stdout: CliProgressStdout;
  readonly #isTTY: boolean;
  #surface: CliSurfaceState = { hasLiveLine: false };

  constructor(stdout: CliProgressStdout) {
    this.#stdout = stdout;
    this.#isTTY = stdout.isTTY === true && typeof stdout.write === "function";
  }

  get stdout(): CliProgressStdout {
    return this.#stdout;
  }

  finalize(): void {
    if (!this.#isTTY || !this.#surface.hasLiveLine) {
      return;
    }

    this.#stdout.write?.(CLEAR_LINE);
    this.#surface = { hasLiveLine: false };
  }

  applyInstruction(
    snapshot: ProgressSnapshot,
    instruction: ProgressRenderInstruction
  ): void {
    if (instruction.appendMessage) {
      this.#appendBlock(snapshot, instruction.appendMessage);
    }

    if (instruction.renderProgress) {
      this.#renderProgress(snapshot, instruction.renderProgress);
    }
  }

  #appendBlock(
    snapshot: ProgressSnapshot,
    message: string
  ): void {
    if (this.#isTTY && this.#surface.hasLiveLine) {
      this.#stdout.write?.(CLEAR_LINE);
      this.#surface = { hasLiveLine: false };
    }

    this.#stdout.log(message);

    if (!this.#isTTY) {
      return;
    }

    this.#renderLiveLine(snapshot);
  }

  #renderProgress(
    snapshot: ProgressSnapshot,
    options: { significant: boolean }
  ): void {
    if (snapshot.plannedFileCount === undefined) {
      return;
    }

    if (this.#isTTY) {
      this.#renderLiveLine(snapshot);
      return;
    }

    if (!options.significant) {
      return;
    }

    this.#stdout.log(this.#buildLiveLine(snapshot));
  }

  #renderLiveLine(snapshot: ProgressSnapshot): void {
    if (!this.#isTTY || snapshot.plannedFileCount === undefined) {
      return;
    }

    this.#stdout.write?.(`${CLEAR_LINE}${this.#buildLiveLine(snapshot)}`);
    this.#surface = { hasLiveLine: true };
  }

  #buildLiveLine(snapshot: ProgressSnapshot): string {
    const base = `Progress ${snapshot.resolvedFileCount}/${snapshot.plannedFileCount} | active ${snapshot.activeFileCount}`;
    const fullLine = snapshot.activeFileSummary
      ? `${base} | ${snapshot.activeFileSummary}`
      : base;

    return this.#truncateLiveLine(fullLine);
  }

  #truncateLiveLine(line: string): string {
    const columns = this.#stdout.columns;

    if (!this.#isTTY || columns === undefined || !Number.isFinite(columns) || columns <= 0) {
      return line;
    }

    const maxWidth = Math.max(1, Math.floor(columns) - 1);

    if (line.length <= maxWidth) {
      return line;
    }

    if (maxWidth <= 3) {
      return line.slice(0, maxWidth);
    }

    return `${line.slice(0, maxWidth - 3)}...`;
  }
}

export class CliProgressReporter {
  readonly #renderer: CliProgressRenderer;
  #state: CliProgressState = createInitialProgressState();

  constructor(options: { stdout: CliProgressStdout }) {
    this.#renderer = new CliProgressRenderer(options.stdout);
  }

  get stdout(): CliProgressStdout {
    return this.#renderer.stdout;
  }

  handleEvent(event: RunProgressEvent): void {
    const { state, instruction } = reduceProgressEvent(this.#state, event);

    this.#state = state;
    this.#renderer.applyInstruction(createProgressSnapshot(state), instruction);
  }

  finalize(): void {
    this.#renderer.finalize();
  }
}

function createInitialProgressState(): CliProgressState {
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
    case "phase-changed":
      return { state: current, instruction: {} };

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

    default: {
      const unsupportedEvent: never = event;
      return {
        state: current,
        instruction: {
          appendMessage: progressContractWarning(
            `ignored unsupported progress event type: ${String(
          (event as { type?: unknown }).type
            )}`
          )
        }
      };
    }
  }
}

interface ProgressStateTransition {
  state: CliProgressState;
  warning?: string;
}

export function withClaimedFile(
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

export function withProgressedFile(
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

  return withActiveFileProgress(current, filePath, existing.claimOrder);
}

export function withActiveFileProgress(
  current: CliProgressState,
  filePath: string,
  claimOrder: number
): ProgressStateTransition {
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

export function withResolvedOutcome(
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

export function buildActiveFileSummary(
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
