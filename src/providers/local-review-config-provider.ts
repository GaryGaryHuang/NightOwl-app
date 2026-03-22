import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  resolveConfidenceThresholdsFromConfigObject
} from "../core/confidence-thresholds.ts";
import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";
import {
  DEFAULT_MAX_CONCURRENT_FILES,
  resolveMaxConcurrentFilesFromConfigObject
} from "../core/max-concurrent-files.ts";
import type {
  ReviewConfig,
  ReviewMcpServerConfig,
  ReviewMcpServers,
  ReviewConfigProvider
} from "./review-config-provider.ts";

export class LocalReviewConfigProvider implements ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): ReviewConfig {
    const configPath = path.join(repoRoot, ".reviewconfig.json");

    if (!existsSync(configPath)) {
      return buildDefaultReviewConfig();
    }

    try {
      const config = parseReviewConfigObject(readFileSync(configPath, "utf8"));

      return {
        maxConcurrentFiles: resolveMaxConcurrentFilesFromConfigObject(config),
        confidenceThresholds: resolveConfidenceThresholdsFromConfigObject(config),
        mcpServers: resolveMcpServersFromConfigObject(config)
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "invalid review config";

      throw new Error(`${message} at ${configPath}`);
    }
  }
}

function buildDefaultReviewConfig(): ReviewConfig {
  return {
    maxConcurrentFiles: DEFAULT_MAX_CONCURRENT_FILES,
    confidenceThresholds: { ...DEFAULT_CONFIDENCE_THRESHOLDS },
    mcpServers: {}
  };
}

function parseReviewConfigObject(configText: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(configText);
  } catch {
    throw new Error("invalid review config");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid review config");
  }

  return parsed as Record<string, unknown>;
}

function resolveMcpServersFromConfigObject(
  config: Record<string, unknown>
): ReviewMcpServers {
  const rawMcpServers = config.mcpServers;

  if (rawMcpServers === undefined) {
    return {};
  }

  if (!isPlainObject(rawMcpServers)) {
    throw new Error("invalid review config");
  }

  const resolved: ReviewMcpServers = {};

  for (const [name, rawDefinition] of Object.entries(rawMcpServers)) {
    if (!isPlainObject(rawDefinition)) {
      throw new Error("invalid review config");
    }

    const command = rawDefinition.command;
    const isContext7Override = name === "context7";

    if (!isContext7Override) {
      if (typeof command !== "string" || command.trim().length === 0) {
        throw new Error("invalid review config");
      }
    } else if (
      command !== undefined &&
      (typeof command !== "string" || command.trim().length === 0)
    ) {
      throw new Error("invalid review config");
    }

    const type =
      rawDefinition.type === undefined ? "local" : rawDefinition.type;

    if (type !== "local") {
      throw new Error("invalid review config");
    }

    resolved[name] = {
      type,
      ...(command === undefined ? {} : { command }),
      ...(rawDefinition.args === undefined
        ? {}
        : { args: readStringArray(rawDefinition.args) }),
      ...(rawDefinition.env === undefined
        ? {}
        : { env: readStringRecord(rawDefinition.env) }),
      ...(rawDefinition.tools === undefined
        ? {}
        : { tools: readStringArray(rawDefinition.tools) })
    } satisfies ReviewMcpServerConfig;
  }

  return resolved;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("invalid review config");
  }

  return [...value];
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error("invalid review config");
  }

  const entries = Object.entries(value);

  if (entries.some(([, item]) => typeof item !== "string")) {
    throw new Error("invalid review config");
  }

  return Object.fromEntries(entries);
}
