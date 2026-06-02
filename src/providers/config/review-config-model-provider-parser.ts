import type { ReviewConfigModelProvider } from "./review-config-provider.ts";
import {
  isPlainObject,
  readNonBlankString,
  readOptionalField,
  readRequiredField
} from "./review-config-parse-helpers.ts";

const COPILOT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "model"
]);

const BYOK_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "type",
  "baseUrl",
  "model",
  "apiKeyEnv",
  "bearerTokenEnv",
  "wireApi",
  "azure"
]);

const AZURE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "apiVersion"
]);

export function resolveModelProviderFromConfigObject(
  config: Record<string, unknown>
): ReviewConfigModelProvider | undefined {
  const rawModelProvider = config.modelProvider;

  if (rawModelProvider === undefined) {
    return undefined;
  }

  if (!isPlainObject(rawModelProvider)) {
    throw new Error("modelProvider must be a plain object");
  }

  try {
    return resolveModelProvider(rawModelProvider);
  } catch (error) {
    throw new Error(
      `modelProvider: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

function resolveModelProvider(
  rawModelProvider: Record<string, unknown>
): ReviewConfigModelProvider {
  const kind = readRequiredField(
    rawModelProvider,
    "kind",
    readModelProviderKind,
    "'kind' must be \"copilot\" or \"byok\""
  );

  return kind === "copilot"
    ? resolveCopilotModelProvider(rawModelProvider)
    : resolveByokModelProvider(rawModelProvider);
}

function resolveCopilotModelProvider(
  rawModelProvider: Record<string, unknown>
): ReviewConfigModelProvider {
  assertSupportedFields(rawModelProvider, COPILOT_ALLOWED_KEYS);

  const model = readOptionalField(
    rawModelProvider,
    "model",
    readNonBlankString,
    "'model' must be a non-blank string"
  );

  return {
    kind: "copilot",
    ...(model === undefined ? {} : { model })
  };
}

function resolveByokModelProvider(
  rawModelProvider: Record<string, unknown>
): ReviewConfigModelProvider {
  assertNoRawCredentials(rawModelProvider);
  assertSupportedFields(rawModelProvider, BYOK_ALLOWED_KEYS);

  const type = readRequiredField(
    rawModelProvider,
    "type",
    readByokProviderType,
    "'type' must be \"openai\", \"azure\", or \"anthropic\""
  );
  const baseUrl = readRequiredField(
    rawModelProvider,
    "baseUrl",
    readNonBlankString,
    "'baseUrl' must be a non-blank string"
  );
  const model = readRequiredField(
    rawModelProvider,
    "model",
    readNonBlankString,
    "'model' must be a non-blank string"
  );
  const apiKeyEnv = readOptionalField(
    rawModelProvider,
    "apiKeyEnv",
    readNonBlankString,
    "'apiKeyEnv' must be a non-blank string"
  );
  const bearerTokenEnv = readOptionalField(
    rawModelProvider,
    "bearerTokenEnv",
    readNonBlankString,
    "'bearerTokenEnv' must be a non-blank string"
  );
  const wireApi = readOptionalField(
    rawModelProvider,
    "wireApi",
    readWireApi,
    "'wireApi' must be \"completions\" or \"responses\""
  );
  const azure = readOptionalField(
    rawModelProvider,
    "azure",
    readAzureOptions,
    "'azure' must be a plain object"
  );

  if (apiKeyEnv === undefined && bearerTokenEnv === undefined) {
    throw new Error(
      "'apiKeyEnv' or 'bearerTokenEnv' must be configured for BYOK modelProvider"
    );
  }

  return {
    kind: "byok",
    type,
    baseUrl,
    model,
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(bearerTokenEnv === undefined ? {} : { bearerTokenEnv }),
    ...(wireApi === undefined ? {} : { wireApi }),
    ...(azure === undefined ? {} : { azure })
  };
}

function readModelProviderKind(value: unknown): "copilot" | "byok" {
  if (value !== "copilot" && value !== "byok") {
    throw new Error();
  }

  return value;
}

function readByokProviderType(
  value: unknown
): "openai" | "azure" | "anthropic" {
  if (value !== "openai" && value !== "azure" && value !== "anthropic") {
    throw new Error();
  }

  return value;
}

function readWireApi(value: unknown): "completions" | "responses" {
  if (value !== "completions" && value !== "responses") {
    throw new Error();
  }

  return value;
}

function readAzureOptions(value: unknown): { apiVersion?: string } {
  if (!isPlainObject(value)) {
    throw new Error();
  }

  assertSupportedFields(value, AZURE_ALLOWED_KEYS);

  const apiVersion = readOptionalField(
    value,
    "apiVersion",
    readNonBlankString,
    "'azure.apiVersion' must be a non-blank string"
  );

  return {
    ...(apiVersion === undefined ? {} : { apiVersion })
  };
}

function assertNoRawCredentials(rawModelProvider: Record<string, unknown>): void {
  for (const rawCredentialField of ["apiKey", "bearerToken"]) {
    if (rawModelProvider[rawCredentialField] !== undefined) {
      throw new Error(
        `'${rawCredentialField}' is not supported; use environment variable references instead`
      );
    }
  }
}

function assertSupportedFields(
  rawModelProvider: Record<string, unknown>,
  supportedKeys: ReadonlySet<string>
): void {
  for (const key of Object.keys(rawModelProvider)) {
    if (!supportedKeys.has(key)) {
      throw new Error(`'${key}' is not a supported field`);
    }
  }
}
