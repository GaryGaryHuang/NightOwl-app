import type { ProgressRenderInstruction, ProgressSnapshot } from "./progress-state.ts";

const CLEAR_LINE = "\u001b[2K\r";

export interface CliProgressStdout {
  isTTY?: boolean;
  columns?: number;
  log(message: unknown): void;
  write?(chunk: string): boolean;
}

export class CliProgressRenderer {
  readonly #stdout: CliProgressStdout;
  readonly #isTTY: boolean;
  #hasLiveLine = false;

  constructor(stdout: CliProgressStdout) {
    this.#stdout = stdout;
    this.#isTTY = stdout.isTTY === true && typeof stdout.write === "function";
  }

  get stdout(): CliProgressStdout {
    return this.#stdout;
  }

  finalize(): void {
    if (!this.#isTTY || !this.#hasLiveLine) {
      return;
    }

    this.#stdout.write?.(CLEAR_LINE);
    this.#hasLiveLine = false;
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
    if (this.#isTTY && this.#hasLiveLine) {
      this.#stdout.write?.(CLEAR_LINE);
      this.#hasLiveLine = false;
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
    this.#hasLiveLine = true;
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
