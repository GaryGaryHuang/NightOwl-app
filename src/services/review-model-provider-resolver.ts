import type { ProviderConfig } from "@github/copilot-sdk";

import type { ReviewConfigModelProvider } from "../providers/config/review-config-provider.ts";

type ReviewModelProviderEnvironment = Record<string, string | undefined>;

export type ResolvedReviewSessionModelProvider =
  | {
      mode: "copilot";
      model?: string;
    }
  | {
      mode: "byok";
      model: string;
      provider: ProviderConfig;
    };

export function resolveReviewSessionModelProvider(
  modelProvider: ReviewConfigModelProvider | undefined,
  environment: ReviewModelProviderEnvironment = process.env
): ResolvedReviewSessionModelProvider {
  if (modelProvider === undefined || modelProvider.kind === "copilot") {
    return {
      mode: "copilot",
      ...(modelProvider?.model === undefined ? {} : { model: modelProvider.model })
    };
  }

  const apiKey =
    modelProvider.apiKeyEnv === undefined
      ? undefined
      : readRequiredEnvironmentSecret(modelProvider.apiKeyEnv, "apiKeyEnv", environment);
  const bearerToken =
    modelProvider.bearerTokenEnv === undefined
      ? undefined
      : readRequiredEnvironmentSecret(
          modelProvider.bearerTokenEnv,
          "bearerTokenEnv",
          environment
        );

  const provider: ProviderConfig = {
    type: modelProvider.type,
    baseUrl: modelProvider.baseUrl,
    ...(modelProvider.wireApi === undefined
      ? {}
      : { wireApi: modelProvider.wireApi }),
    ...(modelProvider.azure === undefined
      ? {}
      : { azure: modelProvider.azure }),
    ...(bearerToken === undefined
      ? apiKey === undefined
        ? {}
        : { apiKey }
      : { bearerToken })
  };

  return {
    mode: "byok",
    model: modelProvider.model,
    provider
  };
}

function readRequiredEnvironmentSecret(
  envName: string,
  configField: "apiKeyEnv" | "bearerTokenEnv",
  environment: ReviewModelProviderEnvironment
): string {
  const value = environment[envName];

  if (value === undefined || value.length === 0) {
    throw new Error(
      `modelProvider.${configField} references missing environment variable '${envName}'`
    );
  }

  return value;
}
