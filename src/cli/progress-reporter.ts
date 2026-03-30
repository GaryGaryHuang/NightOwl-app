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

export class CliProgressReporter {
  readonly #stdout: CliProgressStdout;
  readonly #isTTY: boolean;
  readonly #activeFiles = new Map<string, ActiveFileState>();
  #plannedFileCount?: number;
  #successfulFileCount = 0;
  #skippedFileCount = 0;
  #eventSeq = 0;
  #hasLiveLine = false;

  constructor(options: { stdout: CliProgressStdout }) {
    this.#stdout = options.stdout;
    this.#isTTY = options.stdout.isTTY === true && typeof options.stdout.write === "function";
  }

  get stdout(): CliProgressStdout {
    return this.#stdout;
  }

  handleEvent(event: RunProgressEvent): void {
    switch (event.type) {
      case "phase-changed":
        return;
      case "run-initialized":
        this.#plannedFileCount = event.plannedFileCount;
        this.#appendBlock(`Output: ${event.outputTarget.basePath}`);
        this.#renderProgress({ significant: true });
        return;
      case "file-claimed":
        this.#activeFiles.set(event.filePath, {
          claimOrder: event.claimOrder,
          lastProgressSeq: ++this.#eventSeq
        });
        this.#renderProgress({ significant: false });
        return;
      case "file-progressed": {
        const current = this.#activeFiles.get(event.filePath);
        this.#activeFiles.set(event.filePath, {
          claimOrder: current?.claimOrder ?? Number.MAX_SAFE_INTEGER,
          lastProgressSeq: ++this.#eventSeq
        });
        this.#renderProgress({ significant: false });
        return;
      }
      case "file-completed":
        this.#activeFiles.delete(event.filePath);
        this.#successfulFileCount = event.successfulFileCount;
        this.#skippedFileCount = event.skippedFileCount;
        this.#renderProgress({ significant: true });
        return;
      case "file-skipped":
        this.#activeFiles.delete(event.filePath);
        this.#successfulFileCount = event.successfulFileCount;
        this.#skippedFileCount = event.skippedFileCount;
        this.#appendBlock(
          `Skipped: ${event.filePath} | ${event.stepId} | ${event.reason}`
        );
        this.#renderProgress({ significant: true });
        return;
      case "run-finalizing":
        this.#successfulFileCount = event.successfulFileCount;
        this.#skippedFileCount = event.skippedFileCount;
        this.#plannedFileCount = event.plannedFileCount;
        this.#renderProgress({ significant: true });
        return;
      default:
        return;
    }
  }

  finalize(): void {
    if (!this.#isTTY || !this.#hasLiveLine) {
      return;
    }

    this.#stdout.write?.(CLEAR_LINE);
    this.#hasLiveLine = false;
  }

  #appendBlock(message: string): void {
    if (this.#isTTY && this.#hasLiveLine) {
      this.#stdout.write?.(CLEAR_LINE);
      this.#hasLiveLine = false;
    }

    this.#stdout.log(message);

    if (this.#isTTY) {
      this.#renderLiveLine();
    }
  }

  #renderProgress(options: { significant: boolean }): void {
    if (this.#plannedFileCount === undefined) {
      return;
    }

    if (this.#isTTY) {
      this.#renderLiveLine();
      return;
    }

    if (!options.significant) {
      return;
    }

    this.#stdout.log(this.#buildLiveLine());
  }

  #renderLiveLine(): void {
    if (!this.#isTTY || this.#plannedFileCount === undefined) {
      return;
    }

    this.#stdout.write?.(`${CLEAR_LINE}${this.#buildLiveLine()}`);
    this.#hasLiveLine = true;
  }

  #buildLiveLine(): string {
    const resolvedCount = this.#successfulFileCount + this.#skippedFileCount;
    const activeSummary = this.#buildActiveFileSummary();
    const base = `Progress ${resolvedCount}/${this.#plannedFileCount} | active ${this.#activeFiles.size}`;
    const fullLine = activeSummary ? `${base} | ${activeSummary}` : base;

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

  #buildActiveFileSummary(): string {
    const activeFiles = [...this.#activeFiles.entries()]
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

    const visibleFiles = activeFiles.slice(0, 3);
    const hiddenCount = Math.max(0, activeFiles.length - visibleFiles.length);
    const visibleSummary = visibleFiles.join(", ");

    if (!visibleSummary) {
      return "";
    }

    return hiddenCount > 0 ? `${visibleSummary} | +${hiddenCount} more` : visibleSummary;
  }
}