import type { RunProgressEvent } from "../core/run-progress.ts";
import {
  CliProgressRenderer,
  type CliProgressStdout
} from "./progress-renderer.ts";
import {
  createInitialProgressState,
  createProgressSnapshot,
  reduceProgressEvent,
  type CliProgressState
} from "./progress-state.ts";

export type { CliProgressStdout } from "./progress-renderer.ts";

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
