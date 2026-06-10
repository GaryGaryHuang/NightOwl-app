import assert from "node:assert/strict";
import test from "node:test";

import { resolveReviewSessionModelProvider } from "../../src/services/review-model-provider-resolver.ts";

test("resolveReviewSessionModelProvider preserves Copilot mode without SDK provider by default", () => {
  assert.deepEqual(resolveReviewSessionModelProvider(undefined, {}), {
    mode: "copilot"
  });
  assert.deepEqual(
    resolveReviewSessionModelProvider(
      {
        kind: "copilot",
        model: "gpt-5.4-mini",
        reasoningEffort: "high"
      },
      {}
    ),
    {
      mode: "copilot",
      model: "gpt-5.4-mini",
      reasoningEffort: "high"
    }
  );
});

test("resolveReviewSessionModelProvider resolves BYOK apiKey env and maps SDK ProviderConfig", () => {
  assert.deepEqual(
    resolveReviewSessionModelProvider(
      {
        kind: "byok",
        type: "openai",
        baseUrl: "https://llm-gateway.example.com/v1",
        model: "company-review",
        reasoningEffort: "configured-effort",
        apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY"
      },
      {
        NIGHTOWL_OPENAI_API_KEY: "sk-test"
      }
    ),
    {
      mode: "byok",
      model: "company-review",
      reasoningEffort: "configured-effort",
      provider: {
        type: "openai",
        baseUrl: "https://llm-gateway.example.com/v1",
        apiKey: "sk-test"
      }
    }
  );
});

test("resolveReviewSessionModelProvider resolves optional wire API and Azure API version", () => {
  assert.deepEqual(
    resolveReviewSessionModelProvider(
      {
        kind: "byok",
        type: "azure",
        baseUrl: "https://example.openai.azure.com/openai/deployments/review",
        model: "review-deployment",
        bearerTokenEnv: "NIGHTOWL_AZURE_TOKEN",
        wireApi: "responses",
        azure: {
          apiVersion: "2024-10-21"
        }
      },
      {
        NIGHTOWL_AZURE_TOKEN: "azure-token"
      }
    ),
    {
      mode: "byok",
      model: "review-deployment",
      provider: {
        type: "azure",
        baseUrl: "https://example.openai.azure.com/openai/deployments/review",
        bearerToken: "azure-token",
        wireApi: "responses",
        azure: {
          apiVersion: "2024-10-21"
        }
      }
    }
  );
});

test("resolveReviewSessionModelProvider fails clearly when a configured BYOK env var is missing", () => {
  assert.throws(
    () =>
      resolveReviewSessionModelProvider(
        {
          kind: "byok",
          type: "anthropic",
          baseUrl: "https://api.anthropic.com/v1",
          model: "claude-review",
          apiKeyEnv: "NIGHTOWL_ANTHROPIC_API_KEY"
        },
        {}
      ),
    /NIGHTOWL_ANTHROPIC_API_KEY/u
  );
});

test("resolveReviewSessionModelProvider gives bearer token precedence when both env names are configured", () => {
  const resolved = resolveReviewSessionModelProvider(
    {
      kind: "byok",
      type: "openai",
      baseUrl: "https://llm-gateway.example.com/v1",
      model: "company-review",
      apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY",
      bearerTokenEnv: "NIGHTOWL_GATEWAY_TOKEN"
    },
    {
      NIGHTOWL_OPENAI_API_KEY: "sk-test",
      NIGHTOWL_GATEWAY_TOKEN: "bearer-secret"
    }
  );

  assert.equal(resolved.mode, "byok");
  assert.equal(resolved.provider?.bearerToken, "bearer-secret");
  assert.equal("apiKey" in (resolved.provider ?? {}), false);
});
