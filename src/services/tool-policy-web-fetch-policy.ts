import { isIP } from "node:net";

import {
  DefaultWebFetchHostnameClassifier,
  DEFAULT_WEB_FETCH_HOSTNAME_CLASSIFICATION_TIMEOUT_MS,
  type WebFetchHostnameClassifier
} from "./web-fetch-hostname-classifier.ts";
import { canonicalizeHostnameForComparison, normalizeHostnameForNetworkChecks } from "./web-fetch-hostname-normalization.ts";
import {
  DefaultWebFetchPublicAddressPolicy,
  type WebFetchPublicAddressPolicy
} from "./web-fetch-public-address-policy.ts";

export interface ToolPolicyDecisionDeny {
  permissionDecision: "deny";
  permissionDecisionReason: string;
}

export type ToolPolicyDecision = ToolPolicyDecisionDeny | undefined;

export const UNSAFE_WEB_FETCH_URL_REASON =
  "Review sessions only allow fetching absolute public https URLs.";
export const CONFIGURED_WEB_FETCH_HOST_REASON =
  "Review sessions only allow fetching configured public https hosts.";

export interface ToolPolicyWebFetchPolicyOptions {
  addressPolicy?: WebFetchPublicAddressPolicy;
  hostnameClassifier?: WebFetchHostnameClassifier;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
  webFetchHostnameClassificationTimeoutMs?: number;
}

export class ToolPolicyWebFetchPolicy {
  readonly #addressPolicy: WebFetchPublicAddressPolicy;
  readonly #hostnameClassifier: WebFetchHostnameClassifier;
  readonly #webFetchAllowedHosts?: Set<string>;
  readonly #webFetchWildcardSuffixes?: readonly string[];
  readonly #webFetchDeniedHosts?: Set<string>;
  readonly #webFetchDeniedWildcardSuffixes?: readonly string[];
  readonly #webFetchHostnameClassificationTimeoutMs: number;

  constructor(options: ToolPolicyWebFetchPolicyOptions) {
    this.#addressPolicy =
      options.addressPolicy ?? new DefaultWebFetchPublicAddressPolicy();
    this.#hostnameClassifier =
      options.hostnameClassifier ?? new DefaultWebFetchHostnameClassifier();
    this.#webFetchHostnameClassificationTimeoutMs =
      options.webFetchHostnameClassificationTimeoutMs ??
      DEFAULT_WEB_FETCH_HOSTNAME_CLASSIFICATION_TIMEOUT_MS;

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
    const parsedUrl = parseAllowedWebFetchUrl(urlString, this.#addressPolicy);

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

    return this.evaluateHostnameClassification(parsedUrl);
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

  async evaluateHostnameClassification(url: URL): Promise<ToolPolicyDecision> {
    const normalizedHostname = canonicalizeHostnameForComparison(url.hostname);

    if (isIP(normalizedHostname) !== 0) {
      return undefined;
    }

    return this.#hostnameClassifier
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

function parseAllowedWebFetchUrl(urlString: string, addressPolicy: WebFetchPublicAddressPolicy): URL | undefined {
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
    return addressPolicy.isAllowed(normalizedHostname) ? parsed : undefined;
  }

  if (ipVersion === 6) {
    return addressPolicy.isAllowed(normalizedHostname) ? parsed : undefined;
  }

  return parsed;
}
