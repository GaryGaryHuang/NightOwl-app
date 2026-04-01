import { isIP } from "node:net";

import {
  canonicalizeHostnameForComparison,
  DefaultWebFetchHostnameClassifier,
  DEFAULT_WEB_FETCH_HOSTNAME_CLASSIFICATION_TIMEOUT_MS,
  normalizeHostnameForNetworkChecks,
  type WebFetchHostnameClassifier
} from "./web-fetch-hostname-classifier.ts";
import {
  DefaultWebFetchRedirectResolver,
  DEFAULT_WEB_FETCH_REDIRECT_HOP_LIMIT,
  DEFAULT_WEB_FETCH_REDIRECT_TIMEOUT_MS,
  type WebFetchRedirectResolver
} from "./web-fetch-redirect-resolver.ts";

export interface ToolPolicyDecisionDeny {
  permissionDecision: "deny";
  permissionDecisionReason: string;
}

export type ToolPolicyDecision = ToolPolicyDecisionDeny | undefined;

export const UNSAFE_WEB_FETCH_URL_REASON =
  "Review sessions only allow url for absolute public https URLs.";
export const CONFIGURED_WEB_FETCH_HOST_REASON =
  "Review sessions only allow url for configured public https hosts.";

export interface ToolPolicyWebFetchPolicyOptions {
  hostnameClassifier?: WebFetchHostnameClassifier;
  redirectResolver?: WebFetchRedirectResolver;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
  webFetchHostnameClassificationTimeoutMs?: number;
  webFetchRedirectHopLimit?: number;
  webFetchRedirectTimeoutMs?: number;
}

export class ToolPolicyWebFetchPolicy {
  readonly #hostnameClassifier: WebFetchHostnameClassifier;
  readonly #redirectResolver: WebFetchRedirectResolver;
  readonly #webFetchAllowedHosts?: Set<string>;
  readonly #webFetchWildcardSuffixes?: readonly string[];
  readonly #webFetchDeniedHosts?: Set<string>;
  readonly #webFetchDeniedWildcardSuffixes?: readonly string[];
  readonly #webFetchHostnameClassificationTimeoutMs: number;
  readonly #webFetchRedirectHopLimit: number;
  readonly #webFetchRedirectTimeoutMs: number;

  constructor(options: ToolPolicyWebFetchPolicyOptions) {
    this.#hostnameClassifier =
      options.hostnameClassifier ?? new DefaultWebFetchHostnameClassifier();
    this.#redirectResolver =
      options.redirectResolver ?? new DefaultWebFetchRedirectResolver();
    this.#webFetchHostnameClassificationTimeoutMs =
      options.webFetchHostnameClassificationTimeoutMs ??
      DEFAULT_WEB_FETCH_HOSTNAME_CLASSIFICATION_TIMEOUT_MS;
    this.#webFetchRedirectHopLimit =
      options.webFetchRedirectHopLimit ?? DEFAULT_WEB_FETCH_REDIRECT_HOP_LIMIT;
    this.#webFetchRedirectTimeoutMs =
      options.webFetchRedirectTimeoutMs ?? DEFAULT_WEB_FETCH_REDIRECT_TIMEOUT_MS;

    if (options.webFetchAllowedHosts === undefined) {
      this.#webFetchAllowedHosts = undefined;
      this.#webFetchWildcardSuffixes = undefined;
    } else {
      const exactHosts = new Set<string>();
      const wildcardSuffixes: string[] = [];

      for (const host of options.webFetchAllowedHosts) {
        if (host.startsWith("*.")) {
          wildcardSuffixes.push(`.${host.slice(2)}`);
        } else {
          exactHosts.add(canonicalizeHostnameForComparison(host));
        }
      }

      this.#webFetchAllowedHosts = exactHosts;
      this.#webFetchWildcardSuffixes = wildcardSuffixes;
    }

    if (options.webFetchDeniedHosts === undefined) {
      this.#webFetchDeniedHosts = undefined;
      this.#webFetchDeniedWildcardSuffixes = undefined;
    } else {
      const exactDenied = new Set<string>();
      const deniedWildcardSuffixes: string[] = [];

      for (const host of options.webFetchDeniedHosts) {
        if (host.startsWith("*.")) {
          deniedWildcardSuffixes.push(`.${host.slice(2)}`);
        } else {
          exactDenied.add(canonicalizeHostnameForComparison(host));
        }
      }

      this.#webFetchDeniedHosts = exactDenied;
      this.#webFetchDeniedWildcardSuffixes = deniedWildcardSuffixes;
    }
  }

  async evaluate(urlString: string): Promise<ToolPolicyDecision> {
    const parsedUrl = parseAllowedWebFetchUrl(urlString);

    if (!parsedUrl) {
      return {
        permissionDecision: "deny",
        permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
      };
    }

    const hostPolicyDecision = this.evaluateHostPolicy(parsedUrl);

    if (hostPolicyDecision) {
      return hostPolicyDecision;
    }

    return this.evaluateHostnameClassification(
      parsedUrl,
      new Map()
    );
  }

  evaluateHostPolicy(url: URL): ToolPolicyDecision {
    const normalizedHostname = canonicalizeHostnameForComparison(url.hostname);

    if (this.#webFetchAllowedHosts !== undefined) {
      if (
        !this.#webFetchAllowedHosts.has(normalizedHostname) &&
        !(this.#webFetchWildcardSuffixes ?? []).some((suffix) =>
          normalizedHostname.endsWith(suffix)
        )
      ) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
        };
      }
    }

    if (this.#webFetchDeniedHosts !== undefined) {
      return evaluateWebFetchDenyList(
        normalizedHostname,
        this.#webFetchDeniedHosts,
        this.#webFetchDeniedWildcardSuffixes
      );
    }

    return undefined;
  }

  async evaluateHostnameClassification(
    url: URL,
    decisionCache: Map<string, Promise<ToolPolicyDecision>>
  ): Promise<ToolPolicyDecision> {
    const normalizedHostname = canonicalizeHostnameForComparison(url.hostname);

    if (isIP(normalizedHostname) !== 0) {
      return undefined;
    }

    const cachedDecision = decisionCache.get(normalizedHostname);

    if (cachedDecision) {
      return cachedDecision;
    }

    const decisionPromise = this.#hostnameClassifier
      .classifyHostname(normalizedHostname, {
        timeoutMs: this.#webFetchHostnameClassificationTimeoutMs
      })
      .then((classification): ToolPolicyDecision => {
        if (classification.kind === "denied") {
          return {
            permissionDecision: "deny",
            permissionDecisionReason: classification.reason
          };
        }

        return undefined;
      });

    decisionCache.set(normalizedHostname, decisionPromise);

    return decisionPromise;
  }
}

function evaluateWebFetchDenyList(
  normalizedHostname: string,
  webFetchDeniedHosts: ReadonlySet<string>,
  webFetchDeniedWildcardSuffixes?: readonly string[]
): ToolPolicyDecision {
  if (
    webFetchDeniedHosts.has(normalizedHostname) ||
    (webFetchDeniedWildcardSuffixes ?? []).some((suffix) =>
      normalizedHostname.endsWith(suffix)
    )
  ) {
    return {
      permissionDecision: "deny",
      permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
    };
  }

  return undefined;
}

function parseAllowedWebFetchUrl(urlString: string): URL | undefined {
  let parsed: URL;

  try {
    parsed = new URL(urlString);
  } catch {
    return undefined;
  }

  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname
  ) {
    return undefined;
  }

  const normalizedHostname = normalizeHostnameForNetworkChecks(parsed.hostname);

  if (normalizedHostname === "localhost") {
    return undefined;
  }

  const ipVersion = isIP(normalizedHostname);

  if (ipVersion === 4) {
    return isDisallowedIpv4(normalizedHostname) ? undefined : parsed;
  }

  if (ipVersion === 6) {
    return isDisallowedIpv6(normalizedHostname) ? undefined : parsed;
  }

  return parsed;
}

function isDisallowedIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((value) => Number.parseInt(value, 10));

  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
    return true;
  }

  if (octets[0] === 10 || octets[0] === 127) {
    return true;
  }

  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }

  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }

  return false;
}

function isDisallowedIpv6(hostname: string): boolean {
  const mappedIpv4 = extractMappedIpv4(hostname);

  if (mappedIpv4) {
    return isDisallowedIpv4(mappedIpv4);
  }

  return (
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    /^fe[89ab]/u.test(hostname)
  );
}

function extractMappedIpv4(hostname: string): string | undefined {
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
