export interface GracefulShutdownClientManagerLike {
  stop(): Promise<unknown>;
  forceStop(): Promise<unknown>;
}

export const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;

const STOP_TIMEOUT_EXCEEDED = Symbol("stop-timeout-exceeded");

/**
 * Try a graceful client shutdown first, then forceStop() if stop() exceeds the timeout.
 */
export async function stopClientManagerWithTimeout(
  clientManager: GracefulShutdownClientManagerLike,
  timeoutMs: number
): Promise<void> {
  const stopPromise = clientManager.stop();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let stopResult: void | typeof STOP_TIMEOUT_EXCEEDED = undefined;

  try {
    stopResult = await Promise.race([
      stopPromise.then(() => undefined),
      new Promise<typeof STOP_TIMEOUT_EXCEEDED>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve(STOP_TIMEOUT_EXCEEDED);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  if (stopResult !== STOP_TIMEOUT_EXCEEDED) {
    return;
  }

  // stop() may still settle after timeout; handle that late rejection while forceStop() takes over.
  void stopPromise.catch(() => {});
  await clientManager.forceStop();
}