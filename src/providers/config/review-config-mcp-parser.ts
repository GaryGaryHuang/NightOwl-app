import type {
  ReviewMcpServers
} from "../../core/review-mcp-server-config.ts";
import { isPlainObject } from "./review-config-parse-helpers.ts";
import { resolveMcpServerEntry } from "./review-config-mcp-entry-parser.ts";

export function resolveMcpServersFromConfigObject(
  config: Record<string, unknown>
): ReviewMcpServers {
  const rawMcpServers = config.mcpServers;

  if (rawMcpServers === undefined) {
    return {};
  }

  if (!isPlainObject(rawMcpServers)) {
    throw new Error("mcpServers must be a plain object");
  }

  const resolved: ReviewMcpServers = {};

  for (const [name, rawDefinition] of Object.entries(rawMcpServers)) {
    try {
      resolved[name] = resolveMcpServerEntry(name, rawDefinition);
    } catch (error) {
      throw new Error(
        `mcpServers.${name}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  return resolved;
}
