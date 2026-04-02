export const DEFAULT_WEB_FETCH_REDIRECT_HOP_LIMIT = 5;
export const DEFAULT_WEB_FETCH_REDIRECT_TIMEOUT_MS = 5000;
export const UNSAFE_WEB_FETCH_REDIRECT_CHAIN_REASON =
  "Review sessions only allow fetching URLs when redirect chains resolve safely.";

export interface WebFetchRedirectResolveOptions {
  maxHops: number;
  timeoutMs: number;
  validateRedirectTarget?: (redirectTarget: URL) => string | Promise<string | undefined> | undefined;
}

export type WebFetchRedirectResolution =
  | {
      kind: "resolved";
      redirectChain: URL[];
    }
  | {
      kind: "denied";
      reason: string;
    };

export interface WebFetchRedirectResolver {
  resolveRedirectChain(
    initialUrl: URL,
    options: WebFetchRedirectResolveOptions
  ): Promise<WebFetchRedirectResolution>;
}

export interface WebFetchResolverResponseLike {
  body?: Pick<ReadableStream<Uint8Array>, "cancel"> | null;
  headers: Pick<Headers, "get">;
  status: number;
}

export type WebFetchResolverFetchLike = (
  input: string,
  init: {
    redirect: "manual";
    signal: AbortSignal;
  }
) => Promise<WebFetchResolverResponseLike>;

export interface DefaultWebFetchRedirectResolverOptions {
  fetchFn?: WebFetchResolverFetchLike;
}

/**
 * Follow redirects manually so each hop can be validated before the next request is trusted.
 */
export class DefaultWebFetchRedirectResolver
  implements WebFetchRedirectResolver {
  readonly #fetchFn: WebFetchResolverFetchLike;

  constructor(options: DefaultWebFetchRedirectResolverOptions = {}) {
    this.#fetchFn = options.fetchFn ?? defaultFetchLike;
  }

  async resolveRedirectChain(
    initialUrl: URL,
    options: WebFetchRedirectResolveOptions
  ): Promise<WebFetchRedirectResolution> {
    const redirectChain: URL[] = [];
    const visited = new Set<string>([initialUrl.toString()]);
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    let currentUrl = initialUrl;
    let redirectsFollowed = 0;

    while (true) {
      let response: WebFetchResolverResponseLike;

      try {
        response = await this.#fetchFn(currentUrl.toString(), {
          redirect: "manual",
          signal: timeoutSignal
        });
      } catch {
        return {
          kind: "denied",
          reason: UNSAFE_WEB_FETCH_REDIRECT_CHAIN_REASON
        };
      }

      try {
        if (!isTrackedRedirectStatus(response.status)) {
          return {
            kind: "resolved",
            redirectChain
          };
        }

        const location = response.headers.get("location")?.trim();

        if (!location) {
          return {
            kind: "denied",
            reason: UNSAFE_WEB_FETCH_REDIRECT_CHAIN_REASON
          };
        }

        let nextUrl: URL;

        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return {
            kind: "denied",
            reason: UNSAFE_WEB_FETCH_REDIRECT_CHAIN_REASON
          };
        }

        redirectsFollowed += 1;

        if (redirectsFollowed > options.maxHops) {
          return {
            kind: "denied",
            reason: UNSAFE_WEB_FETCH_REDIRECT_CHAIN_REASON
          };
        }

        const nextUrlKey = nextUrl.toString();

        if (visited.has(nextUrlKey)) {
          return {
            kind: "denied",
            reason: UNSAFE_WEB_FETCH_REDIRECT_CHAIN_REASON
          };
        }

        const redirectTargetValidationReason = await options.validateRedirectTarget?.(
          nextUrl
        );

        if (redirectTargetValidationReason) {
          // Reject the chain immediately when the next hop fails the caller's policy check.
          return {
            kind: "denied",
            reason: redirectTargetValidationReason
          };
        }

        visited.add(nextUrlKey);
        redirectChain.push(nextUrl);
        currentUrl = nextUrl;
      } finally {
        await cancelResponseBody(response);
      }
    }
  }
}

function defaultFetchLike(
  input: string,
  init: { redirect: "manual"; signal: AbortSignal }
): Promise<WebFetchResolverResponseLike> {
  return fetch(input, {
    method: "GET",
    redirect: init.redirect,
    signal: init.signal
  });
}

async function cancelResponseBody(response: WebFetchResolverResponseLike): Promise<void> {
  try {
    await response.body?.cancel?.();
  } catch {
    // Ignore cleanup failures; the guardrail decision has already been made.
  }
}

function isTrackedRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
