/**
 * Provider-internal boundary error wrapping helper.
 *
 * Wraps an async operation so that any thrown error is converted via a
 * caller-supplied factory, preserving type-safe error construction for
 * each boundary's specific error class and options.
 *
 * @internal Not part of the public API.
 */
export async function wrapBoundaryError<T>(
  fn: () => Promise<T>,
  toError: (cause: unknown) => Error
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toError(error);
  }
}

/**
 * Wraps a preflight async operation so missing resources can fall back
 * without converting ENOENT into a boundary error, while other failures
 * are still normalized at the provider boundary.
 *
 * @internal Not part of the public API.
 */
export async function wrapBoundaryErrorUnlessEnoent<T>(
  fn: () => Promise<T>,
  onEnoent: () => T | Promise<T>,
  toError: (cause: unknown) => Error
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isEnoent(error)) {
      return onEnoent();
    }

    throw toError(error);
  }
}

export function isEnoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
