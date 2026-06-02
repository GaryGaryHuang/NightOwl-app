import assert from "node:assert/strict";
import test from "node:test";

import { resolveModelProviderFromConfigObject } from "../../src/providers/config/review-config-model-provider-parser.ts";

function assertModelProviderConfigError(input: {
  config: Record<string, unknown>;
  expectedMessage: string;
}): void {
  assert.throws(
    () => resolveModelProviderFromConfigObject(input.config),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /modelProvider/u);
      assert.match(error.message, new RegExp(input.expectedMessage, "u"));
      return true;
    }
  );
}

test("resolveModelProviderFromConfigObject omits absent modelProvider and accepts explicit Copilot mode", () => {
  assert.equal(resolveModelProviderFromConfigObject({}), undefined);
  assert.deepEqual(
    resolveModelProviderFromConfigObject({
      modelProvider: {
        kind: "copilot"
      }
    }),
    {
      kind: "copilot"
    }
  );
  assert.deepEqual(
    resolveModelProviderFromConfigObject({
      modelProvider: {
        kind: "copilot",
        model: "gpt-5.4-mini"
      }
    }),
    {
      kind: "copilot",
      model: "gpt-5.4-mini"
    }
  );
});

test("resolveModelProviderFromConfigObject accepts minimal and optional BYOK provider config", () => {
  assert.deepEqual(
    resolveModelProviderFromConfigObject({
      modelProvider: {
        kind: "byok",
        type: "openai",
        baseUrl: "https://llm-gateway.example.com/v1",
        model: "company-review",
        apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY"
      }
    }),
    {
      kind: "byok",
      type: "openai",
      baseUrl: "https://llm-gateway.example.com/v1",
      model: "company-review",
      apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY"
    }
  );

  assert.deepEqual(
    resolveModelProviderFromConfigObject({
      modelProvider: {
        kind: "byok",
        type: "azure",
        baseUrl: "https://example.openai.azure.com/openai/deployments/review",
        model: "review-deployment",
        bearerTokenEnv: "NIGHTOWL_AZURE_TOKEN",
        wireApi: "responses",
        azure: {
          apiVersion: "2024-10-21"
        }
      }
    }),
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
    }
  );
});

test("resolveModelProviderFromConfigObject rejects invalid modelProvider kind and BYOK type", () => {
  assertModelProviderConfigError({
    config: {
      modelProvider: {
        kind: "custom",
        model: "review-model"
      }
    },
    expectedMessage: "kind"
  });
  assertModelProviderConfigError({
    config: {
      modelProvider: {
        kind: "byok",
        type: "ABC",
        baseUrl: "https://llm-gateway.example.com/v1",
        model: "company-review",
        apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY"
      }
    },
    expectedMessage: "type"
  });
});

test("resolveModelProviderFromConfigObject rejects BYOK config missing required endpoint, model, or env credential reference", () => {
  assertModelProviderConfigError({
    config: {
      modelProvider: {
        kind: "byok",
        type: "openai",
        model: "company-review",
        apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY"
      }
    },
    expectedMessage: "baseUrl"
  });
  assertModelProviderConfigError({
    config: {
      modelProvider: {
        kind: "byok",
        type: "openai",
        baseUrl: "https://llm-gateway.example.com/v1",
        apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY"
      }
    },
    expectedMessage: "model"
  });
  assertModelProviderConfigError({
    config: {
      modelProvider: {
        kind: "byok",
        type: "openai",
        baseUrl: "https://llm-gateway.example.com/v1",
        model: "company-review"
      }
    },
    expectedMessage: "apiKeyEnv.*bearerTokenEnv|bearerTokenEnv.*apiKeyEnv"
  });
});

test("resolveModelProviderFromConfigObject rejects raw credentials and unsupported provider fields", () => {
  for (const rawCredential of ["apiKey", "bearerToken"]) {
    assertModelProviderConfigError({
      config: {
        modelProvider: {
          kind: "byok",
          type: "openai",
          baseUrl: "https://llm-gateway.example.com/v1",
          model: "company-review",
          apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY",
          [rawCredential]: "secret"
        }
      },
      expectedMessage: rawCredential
    });
  }

  for (const unsupportedField of ["headers", "modelId", "wireModel", "maxPromptTokens", "maxOutputTokens"]) {
    assertModelProviderConfigError({
      config: {
        modelProvider: {
          kind: "byok",
          type: "openai",
          baseUrl: "https://llm-gateway.example.com/v1",
          model: "company-review",
          apiKeyEnv: "NIGHTOWL_OPENAI_API_KEY",
          [unsupportedField]: unsupportedField === "headers" ? {} : "value"
        }
      },
      expectedMessage: unsupportedField
    });
  }
});
