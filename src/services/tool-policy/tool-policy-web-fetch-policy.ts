import { isIP } from "node:net";

import {
  DefaultWebFetchHostnameClassifier,
  DEFAULT_WEB_FETCH_HOSTNAME_CLASSIFICATION_TIMEOUT_MS,
  type WebFetchHostnameClassifier
} from "./web-fetch-hostname-classifier.ts";
import { canonicalizeHostnameForComparison } from "../../core/web-fetch-hostname-normalization.ts";
import {
  DefaultWebFetchPublicAddressPolicy,
  type WebFetchPublicAddressPolicy
} from "./web-fetch-public-address-policy.ts";
import type { ToolPolicyDecision } from "./tool-policy-types.ts";

export const UNSAFE_WEB_FETCH_URL_REASON =
  "Review sessions only allow fetching absolute public https URLs.";
export const CONFIGURED_WEB_FETCH_HOST_REASON =
  "Review sessions only allow fetching configured public https hosts.";

export interface ToolPolicyWebFetchPolicyOptions {
  hostnameClassifier?: WebFetchHostnameClassifier;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
}

interface HostPatterns {
  exactHosts: ReadonlySet<string>;
  wildcardSuffixes: readonly string[];
}

export class ToolPolicyWebFetchPolicy {
  readonly #addressPolicy: WebFetchPublicAddressPolicy;
  readonly #hostnameClassifier: WebFetchHostnameClassifier;
  readonly #webFetchAllowedHosts?: HostPatterns;
  readonly #webFetchDeniedHosts?: HostPatterns;

  constructor(options: ToolPolicyWebFetchPolicyOptions) {
    const addressPolicy = new DefaultWebFetchPublicAddressPolicy();

    this.#addressPolicy = addressPolicy;
    this.#hostnameClassifier =
      options.hostnameClassifier ??
      new DefaultWebFetchHostnameClassifier({
        addressPolicy
      });
    this.#webFetchAllowedHosts = normalizeHostPatterns(
      options.webFetchAllowedHosts
    );
    this.#webFetchDeniedHosts = normalizeHostPatterns(
      options.webFetchDeniedHosts
    );
  }

  async evaluate(urlString: string): Promise<ToolPolicyDecision> {
    const parsedUrl = parseAllowedWebFetchUrl(urlString, this.#addressPolicy);

    if (!parsedUrl) {
      return {
        permissionDecision: "deny",
        permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
      };
    }

    const hostPolicyDecision = this.#evaluateHostPolicy(parsedUrl);

    if (hostPolicyDecision) {
      return hostPolicyDecision;
    }

    return this.#evaluateHostnameClassification(parsedUrl);
  }

  #evaluateHostPolicy(url: URL): ToolPolicyDecision {
    const normalizedHostname = canonicalizeHostnameForComparison(url.hostname);

    if (
      this.#webFetchAllowedHosts !== undefined &&
      !matchesHostPatterns(normalizedHostname, this.#webFetchAllowedHosts)
    ) {
      return {
        permissionDecision: "deny",
        permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
      };
    }

    if (
      this.#webFetchDeniedHosts !== undefined &&
      matchesHostPatterns(normalizedHostname, this.#webFetchDeniedHosts)
    ) {
      return {
        permissionDecision: "deny",
        permissionDecisionReason: CONFIGURED_WEB_FETCH_HOST_REASON
      };
    }

    return undefined;
  }

  async #evaluateHostnameClassification(url: URL): Promise<ToolPolicyDecision> {
    const normalizedHostname = canonicalizeHostnameForComparison(url.hostname);

    if (isIP(normalizedHostname) !== 0) {
      return undefined;
    }

    return this.#hostnameClassifier
      .classifyHostname(normalizedHostname, {
        timeoutMs: DEFAULT_WEB_FETCH_HOSTNAME_CLASSIFICATION_TIMEOUT_MS
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
  }
}

function normalizeHostPatterns(
  hosts: string[] | undefined
): HostPatterns | undefined {
  if (hosts === undefined) {
    return undefined;
  }

  const exactHosts = new Set<string>();
  const wildcardSuffixes: string[] = [];

  for (const host of hosts) {
    if (host.startsWith("*.")) {
      wildcardSuffixes.push(
        `.${canonicalizeHostnameForComparison(host.slice(2))}`
      );
    } else {
      exactHosts.add(canonicalizeHostnameForComparison(host));
    }
  }

  return { exactHosts, wildcardSuffixes };
}

function matchesHostPatterns(
  normalizedHostname: string,
  patterns: HostPatterns
): boolean {
  return (
    patterns.exactHosts.has(normalizedHostname) ||
    patterns.wildcardSuffixes.some((suffix) =>
      normalizedHostname.endsWith(suffix)
    )
  );
}

function parseAllowedWebFetchUrl(
  urlString: string,
  addressPolicy: WebFetchPublicAddressPolicy
): URL | undefined {
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

  const normalizedHostname = canonicalizeHostnameForComparison(parsed.hostname);

  if (normalizedHostname === "localhost") {
    return undefined;
  }

  const ipVersion = isIP(normalizedHostname);

  if (ipVersion === 4) {
    return addressPolicy.isAllowed(normalizedHostname) ? parsed : undefined;
  }

  if (ipVersion === 6) {
    return addressPolicy.isAllowed(normalizedHostname) ? parsed : undefined;
  }

  return parsed;
}
