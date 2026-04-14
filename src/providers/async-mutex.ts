/**
 * Lightweight in-process async mutex for serializing concurrent operations.
 *
 * Uses a promise-queue pattern — no third-party dependencies required.
 *
 * @internal Not part of the public API.
 */
export class AsyncMutex {
  #queue: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prior = this.#queue;
    let resolve!: () => void;
    this.#queue = new Promise<void>((r) => {
      resolve = r;
    });
    await prior;
    try {
      return await fn();
    } finally {
      resolve();
    }
  }
}
