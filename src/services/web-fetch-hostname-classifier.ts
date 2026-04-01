import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const DEFAULT_WEB_FETCH_HOSTNAME_CLASSIFICATION_TIMEOUT_MS = 5000;
export const UNSAFE_WEB_FETCH_HOSTNAME_REASON =
  "Review sessions only allow url for hostnames that resolve to public network addresses.";

const HOSTNAME_LOOKUP_TIMEOUT_EXCEEDED = Symbol(
  "hostname-lookup-timeout-exceeded"
);

export interface WebFetchHostnameLookupResult {
  address: string;
  family: number;
}

export interface WebFetchHostnameLookupOptions {
  all: true;
  verbatim: true;
}

export type WebFetchHostnameLookupLike = (
  hostname: string,
  options: WebFetchHostnameLookupOptions
) => Promise<WebFetchHostnameLookupResult[]>;

export type WebFetchHostnameClassification =
  | { kind: "allowed" }
  | { kind: "denied"; reason: string };

export interface WebFetchHostnameClassifier {
  classifyHostname(
    hostname: string,
    options: { timeoutMs: number }
  ): Promise<WebFetchHostnameClassification>;
}

export interface DefaultWebFetchHostnameClassifierOptions {
  lookupFn?: WebFetchHostnameLookupLike;
}

/**
 * Resolve every address for a hostname and deny on timeout, lookup failure, or any non-public result.
 */
export class DefaultWebFetchHostnameClassifier
  implements WebFetchHostnameClassifier {
  readonly #lookupFn: WebFetchHostnameLookupLike;

  constructor(options: DefaultWebFetchHostnameClassifierOptions = {}) {
    this.#lookupFn = options.lookupFn ?? defaultLookup;
  }

  async classifyHostname(
    hostname: string,
    options: { timeoutMs: number }
  ): Promise<WebFetchHostnameClassification> {
    const canonicalHostname = canonicalizeHostnameForComparison(hostname);
    // Use all:true so the policy can inspect every resolved address instead of trusting the first one.
    const lookupPromise = this.#lookupFn(canonicalHostname, {
      all: true,
      verbatim: true
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const lookupResult = await Promise.race([
        lookupPromise,
        new Promise<typeof HOSTNAME_LOOKUP_TIMEOUT_EXCEEDED>((resolve) => {
          timeoutHandle = setTimeout(() => {
            resolve(HOSTNAME_LOOKUP_TIMEOUT_EXCEEDED);
          }, options.timeoutMs);
        })
      ]);

      if (lookupResult === HOSTNAME_LOOKUP_TIMEOUT_EXCEEDED) {
        void lookupPromise.catch(() => {});

        return {
          kind: "denied",
          reason: UNSAFE_WEB_FETCH_HOSTNAME_REASON
        };
      }

      if (lookupResult.length === 0) {
        return {
          kind: "denied",
          reason: UNSAFE_WEB_FETCH_HOSTNAME_REASON
        };
      }

      for (const resolvedAddress of lookupResult) {
        if (!isAllowedResolvedWebFetchAddress(resolvedAddress.address)) {
          return {
            kind: "denied",
            reason: UNSAFE_WEB_FETCH_HOSTNAME_REASON
          };
        }
      }

      return { kind: "allowed" };
    } catch {
      return {
        kind: "denied",
        reason: UNSAFE_WEB_FETCH_HOSTNAME_REASON
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

function defaultLookup(
  hostname: string,
  options: WebFetchHostnameLookupOptions
): Promise<WebFetchHostnameLookupResult[]> {
  return dnsLookup(hostname, options);
}

function isAllowedResolvedWebFetchAddress(address: string): boolean {
  const normalizedAddress = normalizeHostnameForNetworkChecks(address);
  const ipVersion = isIP(normalizedAddress);

  if (ipVersion === 4) {
    return !isDisallowedResolvedIpv4(normalizedAddress);
  }

  if (ipVersion === 6) {
    return !isDisallowedResolvedIpv6(normalizedAddress);
  }

  return false;
}

function isDisallowedResolvedIpv4(address: string): boolean {
  const octets = address.split(".").map((value) => Number.parseInt(value, 10));

  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
    return true;
  }

  if (octets[0] === 0 || octets[0] === 10 || octets[0] === 127) {
    return true;
  }

  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
    return true;
  }

  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }

  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  if (octets[0] === 192) {
    if (octets[1] === 168) {
      return true;
    }

    if (octets[1] === 0 && octets[2] === 2) {
      return true;
    }
  }

  if (octets[0] === 198) {
    if (octets[1] >= 18 && octets[1] <= 19) {
      return true;
    }

    if (octets[1] === 51 && octets[2] === 100) {
      return true;
    }
  }

  if (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) {
    return true;
  }

  if (octets[0] >= 224) {
    return true;
  }

  return false;
}

function isDisallowedResolvedIpv6(address: string): boolean {
  const normalizedAddress = normalizeHostnameForNetworkChecks(address);
  const mappedIpv4 = extractMappedIpv4(normalizedAddress);

  if (mappedIpv4) {
    return isDisallowedResolvedIpv4(mappedIpv4);
  }

  return (
    normalizedAddress === "::" ||
    normalizedAddress === "::1" ||
    normalizedAddress.startsWith("fc") ||
    normalizedAddress.startsWith("fd") ||
    /^fe[89ab]/u.test(normalizedAddress) ||
    /^fe[cdef]/u.test(normalizedAddress) ||
    normalizedAddress.startsWith("ff") ||
    /^2001:0?db8:/u.test(normalizedAddress)
  );
}

export function normalizeHostnameForNetworkChecks(hostname: string): string {
  const lowercaseHostname = hostname.toLowerCase();

  return lowercaseHostname.startsWith("[") && lowercaseHostname.endsWith("]")
    ? lowercaseHostname.slice(1, -1)
    : lowercaseHostname;
}

export function canonicalizeHostnameForComparison(hostname: string): string {
  return normalizeHostnameForNetworkChecks(hostname).replace(/\.$/u, "");
}

export function extractMappedIpv4(hostname: string): string | undefined {
  if (!hostname.startsWith("::ffff:")) {
    return undefined;
  }

  const suffix = hostname.slice("::ffff:".length);

  if (isIP(suffix) === 4) {
    return suffix;
  }

  const segments = suffix.split(":");

  if (segments.length !== 2) {
    return undefined;
  }

  const values = segments.map((segment) => Number.parseInt(segment, 16));

  if (
    values.some(
      (value) => Number.isNaN(value) || value < 0 || value > 0xffff
    )
  ) {
    return undefined;
  }

  return [
    values[0] >> 8,
    values[0] & 0xff,
    values[1] >> 8,
    values[1] & 0xff
  ].join(".");
}
