import {
  type PermissionHandler,
  type SessionConfig
} from "@github/copilot-sdk";
import path from "node:path";

import type { ReviewSessionProfile } from "./review-session-factory.ts";
import {
  evaluateReadonlyShellCommand,
  READONLY_BASH_DENY_REASON
} from "./tool-policy-shell-policy.ts";
import type { ToolAuditWriter } from "./tool-audit-writer.ts";
import {
  ToolPolicyWebFetchPolicy,
  UNSAFE_WEB_FETCH_URL_REASON,
  type ToolPolicyWebFetchPolicyOptions
} from "./tool-policy-web-fetch-policy.ts";

type PreToolUseHook = NonNullable<
  NonNullable<SessionConfig["hooks"]>["onPreToolUse"]
>;
type PreToolUseHookInput = Parameters<PreToolUseHook>[0];
type PreToolUseHookResult = Awaited<ReturnType<PreToolUseHook>>;

const SHELL_TOOL_NAMES = new Set(["bash", "sh", "shell"]);
const SHELL_POLICY_FAIL_CLOSED_REASON =
  "Shell policy evaluation failed; denied as a precaution.";

export interface ToolPolicyGuardOptions
  extends ToolPolicyWebFetchPolicyOptions {}

/**
 * Enforce the review session tool boundary for web_fetch, shell, and file access.
 */
export class ToolPolicyGuard {
  readonly #webFetchPolicy: ToolPolicyWebFetchPolicy;

  constructor(options: ToolPolicyGuardOptions) {
    this.#webFetchPolicy = new ToolPolicyWebFetchPolicy(options);
  }

  buildPermissionHandler(
    profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditWriter
  ): PermissionHandler {
    return async (request) => {
      if (
        request.kind === "read" &&
        typeof request.path === "string" &&
        isAllowedReadPath(request.path, profile)
      ) {
        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "read",
          decision: "allow",
          args: { path: request.path }
        });

        return { kind: "approved" };
      }

      if (request.kind === "read") {
        const readPath = typeof request.path === "string" ? request.path : undefined;
        const reason = "Read path is outside the allowed boundary.";

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "read",
          decision: "deny",
          reason,
          args: readPath !== undefined ? { path: readPath } : {}
        });

        return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
      }

      if (request.kind === "write") {
        const fileName =
          "fileName" in request && typeof request.fileName === "string"
            ? request.fileName
            : undefined;
        const reason = "Write operations are not permitted in review sessions.";

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "write",
          decision: "deny",
          reason,
          args: fileName !== undefined ? { path: fileName } : {}
        });

        return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
      }

      return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
    };
  }

  buildPreToolUseHook(
    profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditWriter
  ): PreToolUseHook {
    return async (input: PreToolUseHookInput): Promise<PreToolUseHookResult> => {
      if (input.toolName === "web_fetch") {
        const url =
          input.toolArgs &&
          typeof input.toolArgs === "object" &&
          "url" in input.toolArgs &&
          typeof input.toolArgs.url === "string"
            ? input.toolArgs.url
            : "";
        const decision = await this.#webFetchPolicy.evaluate(url);

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "web_fetch",
          decision: decision ? "deny" : "allow",
          ...(decision ? { reason: decision.permissionDecisionReason } : {}),
          args: { url }
        });

        return decision;
      }

      if (!SHELL_TOOL_NAMES.has(input.toolName)) {
        return;
      }

      let command = "";
      try {
        command =
          input.toolArgs &&
          typeof input.toolArgs === "object" &&
          "command" in input.toolArgs &&
          typeof input.toolArgs.command === "string"
            ? (input.toolArgs.command as string)
            : "";
        const decision = evaluateReadonlyShellCommand(
          command,
          profile,
          input.cwd
        );

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: input.toolName,
          decision: decision ? "deny" : "allow",
          ...(decision ? { reason: decision.permissionDecisionReason } : {}),
          args: { command }
        });

        return decision;
      } catch {
        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: input.toolName,
          decision: "deny",
          reason: SHELL_POLICY_FAIL_CLOSED_REASON,
          args: { command }
        });

        return {
          permissionDecision: "deny",
          permissionDecisionReason: SHELL_POLICY_FAIL_CLOSED_REASON
        };
      }
    };
  }
}

function isAllowedReadPath(
  requestedPath: string,
  profile: Pick<ReviewSessionProfile, "repoRoot" | "outputBaseDir">
): boolean {
  const resolvedPath = path.resolve(requestedPath);
  const repoRoot = path.resolve(profile.repoRoot);
  const nightowlRoot = path.join(repoRoot, ".nightowl");
  const reviewRoot = path.join(nightowlRoot, "review");

  const isWithinRepoSourceTree =
    resolvedPath === repoRoot ||
    (resolvedPath.startsWith(`${repoRoot}${path.sep}`) &&
      resolvedPath !== nightowlRoot &&
      !resolvedPath.startsWith(`${nightowlRoot}${path.sep}`));

  return (
    isWithinRepoSourceTree ||
    resolvedPath === reviewRoot ||
    resolvedPath.startsWith(`${reviewRoot}${path.sep}`)
  );
}

export {
  READONLY_BASH_DENY_REASON,
  SHELL_POLICY_FAIL_CLOSED_REASON,
  SHELL_TOOL_NAMES,
  UNSAFE_WEB_FETCH_URL_REASON
};
