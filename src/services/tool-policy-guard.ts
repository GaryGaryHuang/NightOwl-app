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
const CUSTOM_TOOL_DENY_REASON =
  "Custom tools are not permitted in review sessions.";
const HOOK_DENY_REASON =
  "Hook-initiated tool calls are not permitted in review sessions.";
const UNKNOWN_KIND_DENY_REASON =
  "Unknown permission kind is not permitted in review sessions.";
const EMPTY_TOOL_ARGS_DEFERRED_REASON =
  "Empty toolArgs; deferred to permissionHandler.";
const WEB_FETCH_POLICY_FAIL_CLOSED_REASON =
  "Web fetch policy evaluation failed; denied as a precaution.";

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

      if (request.kind === "shell") {
        const fullCommandText =
          typeof request.fullCommandText === "string"
            ? request.fullCommandText
            : "";
        const args: Record<string, string | undefined> = fullCommandText
          ? { fullCommandText }
          : {};

        if (fullCommandText) {
          try {
            const decision = evaluateReadonlyShellCommand(
              fullCommandText,
              profile
            );
            if (decision) {
              auditWriter?.append({
                ts: new Date().toISOString(),
                tool: "shell",
                decision: "deny",
                reason: decision.permissionDecisionReason,
                args
              });

              return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
            }
          } catch {
            auditWriter?.append({
              ts: new Date().toISOString(),
              tool: "shell",
              decision: "deny",
              reason: SHELL_POLICY_FAIL_CLOSED_REASON,
              args
            });

            return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
          }
        }

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "shell",
          decision: "allow",
          args
        });

        return { kind: "approved" };
      }

      if (request.kind === "url") {
        const url =
          typeof request.url === "string" ? request.url : "";
        const args: Record<string, string | undefined> = url ? { url } : {};

        if (url) {
          try {
            const decision = await this.#webFetchPolicy.evaluate(url);
            if (decision) {
              auditWriter?.append({
                ts: new Date().toISOString(),
                tool: "url",
                decision: "deny",
                reason: decision.permissionDecisionReason,
                args
              });

              return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
            }
          } catch {
            auditWriter?.append({
              ts: new Date().toISOString(),
              tool: "url",
              decision: "deny",
              reason: WEB_FETCH_POLICY_FAIL_CLOSED_REASON,
              args
            });

            return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
          }
        }

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "url",
          decision: "allow",
          args
        });

        return { kind: "approved" };
      }

      if (request.kind === "mcp") {
        const serverName =
          typeof request.serverName === "string"
            ? request.serverName
            : undefined;
        const toolName =
          typeof request.toolName === "string"
            ? request.toolName
            : undefined;
        const args: Record<string, string | undefined> = {};
        if (serverName !== undefined) args.serverName = serverName;
        if (toolName !== undefined) args.toolName = toolName;

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "mcp",
          decision: "allow",
          args
        });

        return { kind: "approved" };
      }

      if (request.kind === "custom-tool") {
        const toolName =
          typeof request.toolName === "string"
            ? request.toolName
            : undefined;
        const args: Record<string, string | undefined> = {};
        if (toolName !== undefined) args.toolName = toolName;

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "custom-tool",
          decision: "deny",
          reason: CUSTOM_TOOL_DENY_REASON,
          args
        });

        return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
      }

      // Defensive: memory kind (not in SDK PermissionRequest.kind union,
      // but exists in session-events.d.ts). Low-risk; approve.
      if (request.kind === "memory") {
        const subject =
          typeof request.subject === "string"
            ? request.subject
            : undefined;
        const args: Record<string, string | undefined> = {};
        if (subject !== undefined) args.subject = subject;

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "memory",
          decision: "allow",
          args
        });

        return { kind: "approved" };
      }

      // Defensive: hook kind (not in SDK PermissionRequest.kind union).
      // Unknown security implications; fail-closed deny.
      if (request.kind === "hook") {
        const toolName =
          typeof request.toolName === "string"
            ? request.toolName
            : undefined;
        const args: Record<string, string | undefined> = {};
        if (toolName !== undefined) args.toolName = toolName;

        auditWriter?.append({
          ts: new Date().toISOString(),
          tool: "hook",
          decision: "deny",
          reason: HOOK_DENY_REASON,
          args
        });

        return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
      }

      // Unknown kind — fail-closed
      auditWriter?.append({
        ts: new Date().toISOString(),
        tool: request.kind,
        decision: "deny",
        reason: UNKNOWN_KIND_DENY_REASON,
        args: {}
      });

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

        if (!url) {
          auditWriter?.append({
            ts: new Date().toISOString(),
            tool: "web_fetch",
            decision: "allow",
            reason: EMPTY_TOOL_ARGS_DEFERRED_REASON,
            args: { url: "" }
          });

          return;
        }

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

        if (!command) {
          auditWriter?.append({
            ts: new Date().toISOString(),
            tool: input.toolName,
            decision: "allow",
            reason: EMPTY_TOOL_ARGS_DEFERRED_REASON,
            args: { command: "" }
          });

          return;
        }

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
  CUSTOM_TOOL_DENY_REASON,
  EMPTY_TOOL_ARGS_DEFERRED_REASON,
  HOOK_DENY_REASON,
  READONLY_BASH_DENY_REASON,
  SHELL_POLICY_FAIL_CLOSED_REASON,
  SHELL_TOOL_NAMES,
  UNKNOWN_KIND_DENY_REASON,
  UNSAFE_WEB_FETCH_URL_REASON,
  WEB_FETCH_POLICY_FAIL_CLOSED_REASON
};
