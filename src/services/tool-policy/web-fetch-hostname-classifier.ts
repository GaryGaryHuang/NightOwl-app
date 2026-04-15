import { lookup as dnsLookup } from "node:dns/promises";
import { DefaultWebFetchPublicAddressPolicy, type WebFetchPublicAddressPolicy } from "./web-fetch-public-address-policy.ts";
import { canonicalizeHostnameForComparison } from "../../core/web-fetch-hostname-normalization.ts";

export const DEFAULT_WEB_FETCH_HOSTNAME_CLASSIFICATION_TIMEOUT_MS = 5000;
export const UNSAFE_WEB_FETCH_HOSTNAME_REASON =
  "Review sessions only allow fetching URLs for hostnames that resolve to public network addresses.";

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
  addressPolicy?: WebFetchPublicAddressPolicy;
  lookupFn?: WebFetchHostnameLookupLike;
}

/**
 * Resolve every address for a hostname and deny on timeout, lookup failure, or any non-public result.
 */
export class DefaultWebFetchHostnameClassifier
  implements WebFetchHostnameClassifier {
  readonly #addressPolicy: WebFetchPublicAddressPolicy;
  readonly #lookupFn: WebFetchHostnameLookupLike;

  constructor(options: DefaultWebFetchHostnameClassifierOptions = {}) {
    this.#addressPolicy =
      options.addressPolicy ?? new DefaultWebFetchPublicAddressPolicy();
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
        if (!this.#addressPolicy.isAllowed(resolvedAddress.address)) {
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
