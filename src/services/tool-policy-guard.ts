import {
  type PermissionHandler,
  type SessionConfig
} from "@github/copilot-sdk";

import { isAllowedReviewReadPath } from "../core/review-access-guard.ts";
import type { ReviewSessionProfile } from "./review-session-factory.ts";
import {
  evaluateReadonlyShellCommand,
  READONLY_BASH_DENY_REASON
} from "./tool-policy-shell-policy.ts";
import type { ToolAuditRecord, ToolAuditSink } from "./tool-audit-writer.ts";
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
const URL_TOOL_NAMES = new Set(["web_fetch", "url"]);
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
  "URL policy evaluation failed; denied as a precaution.";

// Module-scoped intermediate decision record produced by each kind branch inside
// buildPermissionHandler. A single post-dispatch segment reads this record to
// write the audit entry and return the SDK result, keeping audit assembly logic
// in one place rather than duplicated across every branch.
type HandlerDecisionRecord = {
  tool: string;
  decision: "allow" | "deny";
  reason?: string;
  args: Record<string, string | undefined>;
};

export interface ToolPolicyGuardOptions
  extends ToolPolicyWebFetchPolicyOptions {}

/**
 * Enforce the review session tool boundary for url retrieval, shell, and file access.
 */
export class ToolPolicyGuard {
  readonly #webFetchPolicy: ToolPolicyWebFetchPolicy;

  constructor(options: ToolPolicyGuardOptions) {
    this.#webFetchPolicy = new ToolPolicyWebFetchPolicy(options);
  }

  #buildAuditEntry(record: HandlerDecisionRecord): ToolAuditRecord {
    return {
      ts: new Date().toISOString(),
      tool: record.tool,
      decision: record.decision,
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
      args: record.args
    };
  }

  // SDK exposes two independent interception paths:
  //   - onPermissionRequest (PermissionHandler): intercepts SDK permission request
  //     events, covering read / write / shell / url / mcp / custom-tool etc.
  //   - onPreToolUse (PreToolUseHook): first gate before tool execution,
  //     used for inline tool-args validation of web_fetch and bash tools.
  //
  // Both paths fire independently and are not mutually exclusive. A single AI
  // tool call may therefore produce two audit log entries — one from each path.
  // This is expected behaviour: audit records represent SDK interception events,
  // not the number of AI-initiated actions.
  buildPermissionHandler(
    profile: Pick<ReviewSessionProfile, "repoRoot">,
    auditWriter?: ToolAuditSink
  ): PermissionHandler {
    return async (request) => {
      let record: HandlerDecisionRecord;

      if (
        request.kind === "read" &&
        typeof request.path === "string" &&
        isAllowedReviewReadPath(request.path, profile.repoRoot)
      ) {
        record = { tool: "read", decision: "allow", args: { path: request.path } };
      } else if (request.kind === "read") {
        const readPath = typeof request.path === "string" ? request.path : undefined;
        record = {
          tool: "read",
          decision: "deny",
          reason: "Read path is outside the allowed boundary.",
          args: readPath !== undefined ? { path: readPath } : {}
        };
      } else if (request.kind === "write") {
        const fileName =
          "fileName" in request && typeof request.fileName === "string"
            ? request.fileName
            : undefined;
        record = {
          tool: "write",
          decision: "deny",
          reason: "Write operations are not permitted in review sessions.",
          args: fileName !== undefined ? { path: fileName } : {}
        };
      } else if (request.kind === "shell") {
        const fullCommandText =
          typeof request.fullCommandText === "string"
            ? request.fullCommandText
            : "";
        const args: Record<string, string | undefined> = fullCommandText
          ? { fullCommandText }
          : {};

        if (fullCommandText) {
          try {
            const policyDecision = evaluateReadonlyShellCommand(fullCommandText, profile);
            if (policyDecision) {
              record = { tool: request.kind, decision: "deny", reason: policyDecision.permissionDecisionReason, args };
            } else {
              record = { tool: request.kind, decision: "allow", args };
            }
          } catch {
            record = { tool: request.kind, decision: "deny", reason: SHELL_POLICY_FAIL_CLOSED_REASON, args };
          }
        } else {
          record = { tool: request.kind, decision: "allow", args };
        }
      } else if (request.kind === "url") {
        const url = typeof request.url === "string" ? request.url : "";
        const args: Record<string, string | undefined> = url ? { url } : {};

        if (url) {
          try {
            const policyDecision = await this.#webFetchPolicy.evaluate(url);
            if (policyDecision) {
              record = { tool: request.kind, decision: "deny", reason: policyDecision.permissionDecisionReason, args };
            } else {
              record = { tool: request.kind, decision: "allow", args };
            }
          } catch {
            record = { tool: request.kind, decision: "deny", reason: WEB_FETCH_POLICY_FAIL_CLOSED_REASON, args };
          }
        } else {
          record = { tool: request.kind, decision: "allow", args };
        }
      } else if (request.kind === "mcp") {
        const serverName =
          typeof request.serverName === "string" ? request.serverName : undefined;
        const toolName =
          typeof request.toolName === "string" ? request.toolName : undefined;
        const args: Record<string, string | undefined> = {};
        if (serverName !== undefined) args.serverName = serverName;
        if (toolName !== undefined) args.toolName = toolName;
        record = { tool: "mcp", decision: "allow", args };
      } else if (request.kind === "custom-tool") {
        const toolName =
          typeof request.toolName === "string" ? request.toolName : undefined;
        const args: Record<string, string | undefined> = {};
        if (toolName !== undefined) args.toolName = toolName;
        record = { tool: "custom-tool", decision: "deny", reason: CUSTOM_TOOL_DENY_REASON, args };
      } else if (request.kind === "memory") {
        // Defensive: memory kind (not in SDK PermissionRequest.kind union,
        // but exists in session-events.d.ts). Low-risk; approve.
        const subject =
          typeof request.subject === "string" ? request.subject : undefined;
        const args: Record<string, string | undefined> = {};
        if (subject !== undefined) args.subject = subject;
        record = { tool: "memory", decision: "allow", args };
      } else if (request.kind === "hook") {
        // Defensive: hook kind (not in SDK PermissionRequest.kind union).
        // Unknown security implications; fail-closed deny.
        const toolName =
          typeof request.toolName === "string" ? request.toolName : undefined;
        const args: Record<string, string | undefined> = {};
        if (toolName !== undefined) args.toolName = toolName;
        record = { tool: "hook", decision: "deny", reason: HOOK_DENY_REASON, args };
      } else {
        // Unknown kind — fail-closed.
        // Exhaustive check: if the SDK adds a new kind to the PermissionRequest.kind
        // union and a dedicated branch is not added above, TypeScript reports a type
        // error on the next line. This assertion does not execute at runtime.
        const _exhaustiveCheck: never = request.kind;
        void _exhaustiveCheck;
        record = { tool: request.kind as string, decision: "deny", reason: UNKNOWN_KIND_DENY_REASON, args: {} };
      }

      // Post-dispatch: write the single audit record and return the SDK result.
      // Audit assembly is centralised in #buildAuditEntry so any future field
      // addition only needs to be made in one place.
      auditWriter?.append(this.#buildAuditEntry(record));

      return record.decision === "allow"
        ? { kind: "approved" }
        : { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
    };
  }

  buildPreToolUseHook(
    profile: Pick<ReviewSessionProfile, "repoRoot">,
    auditWriter?: ToolAuditSink
  ): PreToolUseHook {
    return async (input: PreToolUseHookInput): Promise<PreToolUseHookResult> => {
      if (URL_TOOL_NAMES.has(input.toolName)) {
        let url = "";
        try {
          url =
            input.toolArgs &&
            typeof input.toolArgs === "object" &&
            "url" in input.toolArgs &&
            typeof input.toolArgs.url === "string"
              ? input.toolArgs.url
              : "";

          if (!url) {
            auditWriter?.append(this.#buildAuditEntry({
              tool: input.toolName,
              decision: "allow",
              reason: EMPTY_TOOL_ARGS_DEFERRED_REASON,
              args: { url: "" }
            }));

            return;
          }

          const decision = await this.#webFetchPolicy.evaluate(url);

          auditWriter?.append(this.#buildAuditEntry({
            tool: input.toolName,
            decision: decision ? "deny" : "allow",
            ...(decision ? { reason: decision.permissionDecisionReason } : {}),
            args: { url }
          }));

          return decision;
        } catch {
          auditWriter?.append(this.#buildAuditEntry({
            tool: input.toolName,
            decision: "deny",
            reason: WEB_FETCH_POLICY_FAIL_CLOSED_REASON,
            args: { url }
          }));

          return {
            permissionDecision: "deny",
            permissionDecisionReason: WEB_FETCH_POLICY_FAIL_CLOSED_REASON
          };
        }
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
          auditWriter?.append(this.#buildAuditEntry({
            tool: input.toolName,
            decision: "allow",
            reason: EMPTY_TOOL_ARGS_DEFERRED_REASON,
            args: { command: "" }
          }));

          return;
        }

        const decision = evaluateReadonlyShellCommand(
          command,
          profile,
          input.cwd
        );

        auditWriter?.append(this.#buildAuditEntry({
          tool: input.toolName,
          decision: decision ? "deny" : "allow",
          ...(decision ? { reason: decision.permissionDecisionReason } : {}),
          args: { command }
        }));

        return decision;
      } catch {
        auditWriter?.append(this.#buildAuditEntry({
          tool: input.toolName,
          decision: "deny",
          reason: SHELL_POLICY_FAIL_CLOSED_REASON,
          args: { command }
        }));

        return {
          permissionDecision: "deny",
          permissionDecisionReason: SHELL_POLICY_FAIL_CLOSED_REASON
        };
      }
    };
  }
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
  URL_TOOL_NAMES,
  WEB_FETCH_POLICY_FAIL_CLOSED_REASON
};
