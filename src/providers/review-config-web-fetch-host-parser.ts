import {
  invalidReviewConfigError
} from "./review-config-parse-helpers.ts";

export function resolveWebFetchAllowedHostsFromConfigObject(
  config: Record<string, unknown>
): string[] | undefined {
  return resolveWebFetchHostsFromConfigObject(config, "webFetchAllowedHosts");
}

export function resolveWebFetchDeniedHostsFromConfigObject(
  config: Record<string, unknown>
): string[] | undefined {
  return resolveWebFetchHostsFromConfigObject(config, "webFetchDeniedHosts");
}

function resolveWebFetchHostsFromConfigObject(
  config: Record<string, unknown>,
  key: "webFetchAllowedHosts" | "webFetchDeniedHosts"
): string[] | undefined {
  const rawHosts = config[key];

  if (rawHosts === undefined) {
    return undefined;
  }

  if (!Array.isArray(rawHosts)) {
    throw invalidReviewConfigError();
  }

  return rawHosts.map((value) => readWebFetchHostEntry(value));
}

function readWebFetchHostEntry(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidReviewConfigError();
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw invalidReviewConfigError();
  }

  if (trimmed.includes("*")) {
    return readWildcardWebFetchHostEntry(trimmed);
  }

  if (/[:/?#\[\]]/u.test(trimmed)) {
    throw invalidReviewConfigError();
  }

  const canonical = canonicalizeHostname(trimmed);

  if (
    canonical.length === 0 ||
    isIpLiteral(canonical) ||
    !HOSTNAME_PATTERN.test(canonical)
  ) {
    throw invalidReviewConfigError();
  }

  return canonical;
}

function readWildcardWebFetchHostEntry(trimmed: string): string {
  if (!trimmed.startsWith("*.")) {
    throw invalidReviewConfigError();
  }

  const base = trimmed.slice(2);

  if (base.length === 0 || base.includes("*") || /[:/?#\[\]]/u.test(base)) {
    throw invalidReviewConfigError();
  }

  const canonicalBase = canonicalizeHostname(base);

  if (
    canonicalBase.length === 0 ||
    isIpLiteral(canonicalBase) ||
    !HOSTNAME_PATTERN.test(canonicalBase)
  ) {
    throw invalidReviewConfigError();
  }

  return `*.${canonicalBase}`;
}

function canonicalizeHostname(value: string): string {
  return value.toLowerCase().replace(/\.$/u, "");
}

function isIpLiteral(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/u.test(value) || value.includes(":");
}

const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u;

