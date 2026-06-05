export interface GracefulShutdownClientManagerLike {
  stop(): Promise<readonly Error[]>;
  forceStop(): Promise<unknown>;
  forceStopCurrentClient?(): Promise<unknown>;
}

export const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;

const STOP_TIMEOUT_EXCEEDED = Symbol("stop-timeout-exceeded");

/**
 * Try a graceful client shutdown first, then forceStop() if stop() exceeds the timeout.
 */
export async function stopClientManagerWithTimeout(
  clientManager: GracefulShutdownClientManagerLike,
  timeoutMs: number
): Promise<readonly Error[]> {
  const stopPromise = clientManager.stop();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let stopResult: readonly Error[] | typeof STOP_TIMEOUT_EXCEEDED = [];

  try {
    stopResult = await Promise.race([
      stopPromise,
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
    return stopResult;
  }

  // stop() may still settle after timeout; handle that late rejection while forceStop() takes over.
  void stopPromise.catch(() => {});
  if (clientManager.forceStopCurrentClient) {
    await clientManager.forceStopCurrentClient();
  } else {
    await clientManager.forceStop();
  }
  return [];
}
