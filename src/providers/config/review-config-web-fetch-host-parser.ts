import { canonicalizeHostnameForComparison } from "../../services/tool-policy/web-fetch-hostname-normalization.ts";

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
    throw new Error(`'${key}' must be an array`);
  }

  return rawHosts.map((value, index) => readWebFetchHostEntry(value, key, index));
}

function readWebFetchHostEntry(
  value: unknown,
  key: string,
  index: number
): string {
  if (typeof value !== "string") {
    throw new Error(`'${key}[${index}]' must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`'${key}[${index}]' must not be empty`);
  }

  if (trimmed.includes("*")) {
    return readWildcardWebFetchHostEntry(trimmed, key, index);
  }

  if (/[:/?#\[\]]/u.test(trimmed)) {
    throw new Error(`'${key}[${index}]' contains invalid characters`);
  }

  const canonical = canonicalizeHostnameForComparison(trimmed);

  if (
    canonical.length === 0 ||
    isIpLiteral(canonical) ||
    !HOSTNAME_PATTERN.test(canonical)
  ) {
    throw new Error(`'${key}[${index}]' is not a valid hostname`);
  }

  return canonical;
}

function readWildcardWebFetchHostEntry(
  trimmed: string,
  key: string,
  index: number
): string {
  if (!trimmed.startsWith("*.")) {
    throw new Error(`'${key}[${index}]' wildcard must use '*.domain' format`);
  }

  const base = trimmed.slice(2);

  if (base.length === 0 || base.includes("*") || /[:/?#\[\]]/u.test(base)) {
    throw new Error(`'${key}[${index}]' contains invalid wildcard base`);
  }

  const canonicalBase = canonicalizeHostnameForComparison(base);

  if (
    canonicalBase.length === 0 ||
    isIpLiteral(canonicalBase) ||
    !HOSTNAME_PATTERN.test(canonicalBase)
  ) {
    throw new Error(`'${key}[${index}]' is not a valid wildcard hostname`);
  }

  return `*.${canonicalBase}`;
}

function isIpLiteral(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/u.test(value) || value.includes(":");
}

const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u;

