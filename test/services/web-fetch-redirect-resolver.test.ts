import assert from "node:assert/strict";
import test from "node:test";

import {
  DefaultWebFetchRedirectResolver,
  type WebFetchResolverResponseLike
} from "../../src/services/web-fetch-redirect-resolver.ts";

type MockResponse = WebFetchResolverResponseLike;

function createResponse(
  status: number,
  headers: Record<string, string> = {},
  options?: {
    onCancel?(): void;
  }
): MockResponse {
  return {
    status,
    headers: new Headers(headers),
    body: options?.onCancel
      ? {
          cancel(): Promise<void> {
            options.onCancel?.();
            return Promise.resolve();
          }
        }
      : undefined
  };
}

test("DefaultWebFetchRedirectResolver treats terminal 200 and 404 responses as resolved with no redirect targets", async () => {
  for (const status of [200, 404]) {
    const calls: string[] = [];
    const resolver = new DefaultWebFetchRedirectResolver({
      fetchFn: async (input) => {
        calls.push(input.toString());
        return createResponse(status) as never;
      }
    });

    const result = await resolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
      maxHops: 5,
      timeoutMs: 5000
    });

    assert.deepEqual(result, { kind: "resolved", redirectChain: [] });
    assert.deepEqual(calls, ["https://docs.example.com/start"]);
  }
});

test("DefaultWebFetchRedirectResolver follows standard redirect statuses and resolves relative Location targets", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const calls: string[] = [];
    const resolver = new DefaultWebFetchRedirectResolver({
      fetchFn: async (input) => {
        calls.push(input.toString());

        if (calls.length === 1) {
          return createResponse(status, { location: "/guide/v2" }) as never;
        }

        return createResponse(200) as never;
      }
    });

    const result = await resolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
      maxHops: 5,
      timeoutMs: 5000
    });

    assert.deepEqual(result, {
      kind: "resolved",
      redirectChain: [new URL("https://docs.example.com/guide/v2")]
    });
    assert.deepEqual(calls, [
      "https://docs.example.com/start",
      "https://docs.example.com/guide/v2"
    ]);
  }
});

test("DefaultWebFetchRedirectResolver denies redirect loops, missing or malformed Location, and hop-limit exhaustion", async () => {
  const loopResolver = new DefaultWebFetchRedirectResolver({
    fetchFn: async (input) => {
      if (input.toString().endsWith("/a")) {
        return createResponse(302, { location: "https://docs.example.com/b" }) as never;
      }

      return createResponse(302, { location: "https://docs.example.com/a" }) as never;
    }
  });

  assert.deepEqual(
    await loopResolver.resolveRedirectChain(new URL("https://docs.example.com/a"), {
      maxHops: 5,
      timeoutMs: 5000
    }),
    {
      kind: "denied",
      reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
    }
  );

  const missingLocationResolver = new DefaultWebFetchRedirectResolver({
    fetchFn: async () => createResponse(302) as never
  });

  assert.deepEqual(
    await missingLocationResolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
      maxHops: 5,
      timeoutMs: 5000
    }),
    {
      kind: "denied",
      reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
    }
  );

  const malformedLocationResolver = new DefaultWebFetchRedirectResolver({
    fetchFn: async () => createResponse(302, { location: "http://%" }) as never
  });

  assert.deepEqual(
    await malformedLocationResolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
      maxHops: 5,
      timeoutMs: 5000
    }),
    {
      kind: "denied",
      reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
    }
  );

  let hop = 0;
  const hopLimitResolver = new DefaultWebFetchRedirectResolver({
    fetchFn: async () => {
      hop += 1;
      return createResponse(302, { location: `https://docs.example.com/${hop}` }) as never;
    }
  });

  assert.deepEqual(
    await hopLimitResolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
      maxHops: 5,
      timeoutMs: 5000
    }),
    {
      kind: "denied",
      reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
    }
  );
});

test("DefaultWebFetchRedirectResolver denies preflight timeout and transport failure", async () => {
  const timeoutResolver = new DefaultWebFetchRedirectResolver({
    fetchFn: async (_input, init) =>
      await new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true }
        );
      })
  });

  assert.deepEqual(
    await timeoutResolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
      maxHops: 5,
      timeoutMs: 5
    }),
    {
      kind: "denied",
      reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
    }
  );

  const transportFailureResolver = new DefaultWebFetchRedirectResolver({
    fetchFn: async () => {
      throw new Error("ECONNRESET");
    }
  });

  assert.deepEqual(
    await transportFailureResolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
      maxHops: 5,
      timeoutMs: 5000
    }),
    {
      kind: "denied",
      reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
    }
  );
});

test("DefaultWebFetchRedirectResolver denies unsafe redirect targets before following the next hop", async () => {
  const calls: string[] = [];
  const resolver = new DefaultWebFetchRedirectResolver({
    fetchFn: async (input) => {
      calls.push(input.toString());
      return createResponse(302, { location: "http://localhost:3000/internal" });
    }
  });

  const result = await resolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
    maxHops: 5,
    timeoutMs: 5000,
    validateRedirectTarget(redirectTarget) {
      return redirectTarget.hostname === "localhost"
        ? "Review sessions only allow web_fetch for absolute public http(s) URLs."
        : undefined;
    }
  });

  assert.deepEqual(result, {
    kind: "denied",
    reason: "Review sessions only allow web_fetch for absolute public http(s) URLs."
  });
  assert.deepEqual(calls, ["https://docs.example.com/start"]);
});

test("DefaultWebFetchRedirectResolver cancels each preflight response body after reading redirect metadata", async () => {
  const canceledResponses: string[] = [];
  let callCount = 0;
  const resolver = new DefaultWebFetchRedirectResolver({
    fetchFn: async () => {
      callCount += 1;

      if (callCount === 1) {
        return createResponse(302, { location: "/guide/v2" }, {
          onCancel() {
            canceledResponses.push("redirect");
          }
        });
      }

      return createResponse(200, {}, {
        onCancel() {
          canceledResponses.push("terminal");
        }
      });
    }
  });

  const result = await resolver.resolveRedirectChain(new URL("https://docs.example.com/start"), {
    maxHops: 5,
    timeoutMs: 5000
  });

  assert.deepEqual(result, {
    kind: "resolved",
    redirectChain: [new URL("https://docs.example.com/guide/v2")]
  });
  assert.deepEqual(canceledResponses, ["redirect", "terminal"]);
});