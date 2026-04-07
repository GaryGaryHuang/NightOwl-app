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

  constructor(stdout: CliProgressStdout) {
    this.#stdout = stdout;
    this.#isTTY = stdout.isTTY === true && typeof stdout.write === "function";
  }

  get stdout(): CliProgressStdout {
    return this.#stdout;
  }

  finalize(surface: CliSurfaceState): CliSurfaceState {
    if (!this.#isTTY || !surface.hasLiveLine) {
      return surface;
    }

    this.#stdout.write?.(CLEAR_LINE);
    return { hasLiveLine: false };
  }

  applyInstruction(
    snapshot: ProgressSnapshot,
    instruction: ProgressRenderInstruction,
    surface: CliSurfaceState
  ): CliSurfaceState {
    let nextSurface = surface;

    if (instruction.appendMessage) {
      nextSurface = this.#appendBlock(snapshot, instruction.appendMessage, nextSurface);
    }

    if (instruction.renderProgress) {
      nextSurface = this.#renderProgress(
        snapshot,
        instruction.renderProgress,
        nextSurface
      );
    }

    return nextSurface;
  }

  #appendBlock(
    snapshot: ProgressSnapshot,
    message: string,
    surface: CliSurfaceState
  ): CliSurfaceState {
    let nextSurface = surface;

    if (this.#isTTY && nextSurface.hasLiveLine) {
      this.#stdout.write?.(CLEAR_LINE);
      nextSurface = { hasLiveLine: false };
    }

    this.#stdout.log(message);

    if (!this.#isTTY) {
      return nextSurface;
    }

    return this.#renderLiveLine(snapshot, nextSurface);
  }

  #renderProgress(
    snapshot: ProgressSnapshot,
    options: { significant: boolean },
    surface: CliSurfaceState
  ): CliSurfaceState {
    if (snapshot.plannedFileCount === undefined) {
      return surface;
    }

    if (this.#isTTY) {
      return this.#renderLiveLine(snapshot, surface);
    }

    if (!options.significant) {
      return surface;
    }

    this.#stdout.log(this.#buildLiveLine(snapshot));
    return surface;
  }

  #renderLiveLine(
    snapshot: ProgressSnapshot,
    surface: CliSurfaceState
  ): CliSurfaceState {
    if (!this.#isTTY || snapshot.plannedFileCount === undefined) {
      return surface;
    }

    this.#stdout.write?.(`${CLEAR_LINE}${this.#buildLiveLine(snapshot)}`);
    return { hasLiveLine: true };
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
  #surface: CliSurfaceState = { hasLiveLine: false };

  constructor(options: { stdout: CliProgressStdout }) {
    this.#renderer = new CliProgressRenderer(options.stdout);
  }

  get stdout(): CliProgressStdout {
    return this.#renderer.stdout;
  }

  handleEvent(event: RunProgressEvent): void {
    const { state, instruction } = reduceProgressEvent(this.#state, event);

    this.#state = state;
    this.#surface = this.#renderer.applyInstruction(
      createProgressSnapshot(state),
      instruction,
      this.#surface
    );
  }

  finalize(): void {
    this.#surface = this.#renderer.finalize(this.#surface);
  }
}

function createInitialProgressState(): CliProgressState {
  return {
    activeFiles: new Map<string, ActiveFileState>(),
    eventSeq: 0,
    skippedFileCount: 0,
    successfulFileCount: 0
  };
}

function reduceProgressEvent(
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
      return {
        state: withActiveFileProgress(current, event.filePath, event.claimOrder),
        instruction: {
          renderProgress: { significant: false }
        }
      };

    case "file-progressed": {
      const existing = current.activeFiles.get(event.filePath);
      return {
        state: withActiveFileProgress(
          current,
          event.filePath,
          existing?.claimOrder ?? Number.MAX_SAFE_INTEGER
        ),
        instruction: {
          renderProgress: { significant: false }
        }
      };
    }

    case "file-completed":
      return {
        state: withResolvedOutcome(
          current,
          event.filePath,
          event.successfulFileCount,
          event.skippedFileCount
        ),
        instruction: {
          renderProgress: { significant: true }
        }
      };

    case "file-skipped":
      return {
        state: withResolvedOutcome(
          current,
          event.filePath,
          event.successfulFileCount,
          event.skippedFileCount
        ),
        instruction: {
          appendMessage: `Skipped: ${event.filePath} | ${event.stepId} | ${event.reason}`,
          renderProgress: { significant: true }
        }
      };

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

    default:
      return { state: current, instruction: {} };
  }
}

function withActiveFileProgress(
  current: CliProgressState,
  filePath: string,
  claimOrder: number
): CliProgressState {
  const activeFiles = new Map(current.activeFiles);
  const nextEventSeq = current.eventSeq + 1;

  activeFiles.set(filePath, {
    claimOrder,
    lastProgressSeq: nextEventSeq
  });

  return {
    ...current,
    activeFiles,
    eventSeq: nextEventSeq
  };
}

function withResolvedOutcome(
  current: CliProgressState,
  filePath: string,
  successfulFileCount: number,
  skippedFileCount: number
): CliProgressState {
  const activeFiles = new Map(current.activeFiles);
  activeFiles.delete(filePath);

  return {
    ...current,
    activeFiles,
    skippedFileCount,
    successfulFileCount
  };
}

function createProgressSnapshot(state: CliProgressState): ProgressSnapshot {
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
