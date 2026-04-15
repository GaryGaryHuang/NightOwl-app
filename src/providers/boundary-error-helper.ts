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

export function isEnoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
