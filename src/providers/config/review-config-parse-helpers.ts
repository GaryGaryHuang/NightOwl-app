export function invalidReviewConfigError(): Error {
  return new Error("invalid review config");
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidReviewConfigError();
  }

  return [...value];
}

export function readStringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    throw invalidReviewConfigError();
  }

  const entries = Object.entries(value);
  const result: Record<string, string> = {};

  for (const [key, item] of entries) {
    if (typeof item !== "string") {
      throw invalidReviewConfigError();
    }

    result[key] = item;
  }

  return result;
}

export function readPositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw invalidReviewConfigError();
  }

  return value;
}

export function readNonBlankString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidReviewConfigError();
  }

  return value;
}

export function readOptionalField<T>(
  raw: Record<string, unknown>,
  field: string,
  reader: (value: unknown) => T,
  errorMessage: string
): T | undefined {
  if (raw[field] === undefined) {
    return undefined;
  }

  try {
    return reader(raw[field]);
  } catch {
    throw new Error(errorMessage);
  }
}

export function readRequiredField<T>(
  raw: Record<string, unknown>,
  field: string,
  reader: (value: unknown) => T,
  errorMessage: string
): T {
  try {
    return reader(raw[field]);
  } catch {
    throw new Error(errorMessage);
  }
}
