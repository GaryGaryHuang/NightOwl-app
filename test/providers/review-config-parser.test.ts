import assert from "node:assert/strict";
import test from "node:test";

import { parseReviewConfig } from "../../src/providers/config/review-config-parser.ts";
import { buildExpectedReviewConfig } from "../helpers/review-config-provider-contract-fixture.ts";

test("parseReviewConfig rejects malformed JSON and non-object top-level values", () => {
  for (const input of ["{", "[]", "\"review\"", "null"]) {
    assert.throws(() => parseReviewConfig(input), /invalid review config/u);
  }
});

test("parseReviewConfig applies documented defaults and omits absent optional webFetch host keys", () => {
  const config = parseReviewConfig("{}");

  assert.deepEqual(config, buildExpectedReviewConfig());
  assert.equal("webFetchAllowedHosts" in config, false);
  assert.equal("webFetchDeniedHosts" in config, false);
});

test("parseReviewConfig rejects unknown top-level keys", () => {
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ mcpServer: {} })),
    /mcpServer/u
  );
  assert.throws(
    () => parseReviewConfig(JSON.stringify({ maxConcurrentFiles: 3, unknownField: true })),
    /unknownField/u
  );
});

test("parseReviewConfig surfaces representative leaf validation failures through the top-level parser", () => {
  for (const { input, expectedMessage } of [
    { input: { maxConcurrentFiles: 0 }, expectedMessage: /maxConcurrentFiles/u },
    { input: { maxConcurrentFiles: -1 }, expectedMessage: /maxConcurrentFiles/u },
    { input: { maxConcurrentFiles: 2.5 }, expectedMessage: /maxConcurrentFiles/u },
    { input: { maxConcurrentFiles: "5" }, expectedMessage: /maxConcurrentFiles/u },
    {
      input: { webFetchAllowedHosts: "docs.example.com" },
      expectedMessage: /webFetchAllowedHosts/u
    },
    {
      input: { webFetchAllowedHosts: ["https://docs.example.com"] },
      expectedMessage: /webFetchAllowedHosts/u
    },
    {
      input: { webFetchAllowedHosts: ["*docs.example.com"] },
      expectedMessage: /webFetchAllowedHosts/u
    },
    { input: { webFetchDeniedHosts: [""] }, expectedMessage: /webFetchDeniedHosts/u },
    {
      input: { webFetchDeniedHosts: ["127.0.0.1"] },
      expectedMessage: /webFetchDeniedHosts/u
    }
  ]) {
    assert.throws(() => parseReviewConfig(JSON.stringify(input)), expectedMessage);
  }
});

test("parseReviewConfig accepts a representative fully-populated config", () => {
  assert.deepEqual(
    parseReviewConfig(
      JSON.stringify({
        maxConcurrentFiles: 3,
        modelProvider: {
          kind: "byok",
          type: "openai",
          baseUrl: "https://llm-gateway.example.com/v1",
          model: "company-review",
          apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY"
        },
        mcpServers: {
          context7: {
            type: "http",
            tools: ["resolve-library-id"],
            timeout: 20000
          }
        },
        webFetchAllowedHosts: [" Docs.Example.com ", "*.API.Example.com"],
        webFetchDeniedHosts: [" Internal.Example.com "]
      })
    ),
    buildExpectedReviewConfig({
      maxConcurrentFiles: 3,
      modelProvider: {
        kind: "byok",
        type: "openai",
        baseUrl: "https://llm-gateway.example.com/v1",
        model: "company-review",
        apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY"
      },
      mcpServers: {
        context7: {
          type: "context7",
          tools: ["resolve-library-id"],
          timeout: 20000
        }
      },
      webFetchAllowedHosts: ["docs.example.com", "*.api.example.com"],
      webFetchDeniedHosts: ["internal.example.com"]
    })
  );
});
