import {
  type PermissionHandler,
  type SessionConfig
} from "@github/copilot-sdk";

import { isAllowedReviewReadPath } from "../../core/review-access-guard.ts";
import {
  evaluateReadonlyShellCommand,
  READONLY_BASH_DENY_REASON
} from "./tool-policy-shell-policy.ts";
import type { ToolAuditRecord, ToolAuditSink } from "../tool-audit-writer.ts";
import {
  ToolPolicyWebFetchPolicy,
  UNSAFE_WEB_FETCH_URL_REASON,
  type ToolPolicyWebFetchPolicyOptions
} from "./tool-policy-web-fetch-policy.ts";
import type {
  ToolPolicyBoundaryContext,
  ToolPolicyDecision,
  ToolPolicyDecisionDeny
} from "./tool-policy-types.ts";

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
const PRE_TOOL_USE_NOT_HANDLED = Symbol("pre-tool-use-not-handled");

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

type PreToolUseDecisionResult =
  | PreToolUseHookResult
  | typeof PRE_TOOL_USE_NOT_HANDLED;

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

  #denyDecision(reason: string): ToolPolicyDecisionDeny {
    return {
      permissionDecision: "deny",
      permissionDecisionReason: reason
    };
  }

  #buildStringArgs(
    key: string,
    value: string
  ): Record<string, string | undefined> {
    return { [key]: value };
  }

  #buildPolicyDecisionRecord(
    tool: string,
    args: Record<string, string | undefined>,
    decision: ToolPolicyDecision
  ): HandlerDecisionRecord {
    return decision
      ? {
          tool,
          decision: "deny",
          reason: decision.permissionDecisionReason,
          args
        }
      : {
          tool,
          decision: "allow",
          args
        };
  }

  #extractHookStringArg(toolArgs: unknown, key: string): string {
    if (!toolArgs || typeof toolArgs !== "object") {
      return "";
    }

    const record = toolArgs as Record<string, unknown>;

    return key in record && typeof record[key] === "string"
      ? (record[key] as string)
      : "";
  }

  #evaluateShellPolicyDecision(
    command: string,
    profile: ToolPolicyBoundaryContext,
    commandCwd?: string
  ): ToolPolicyDecision {
    try {
      return evaluateReadonlyShellCommand(command, profile, commandCwd);
    } catch {
      return this.#denyDecision(SHELL_POLICY_FAIL_CLOSED_REASON);
    }
  }

  async #evaluateUrlPolicyDecision(url: string): Promise<ToolPolicyDecision> {
    try {
      return await this.#webFetchPolicy.evaluate(url);
    } catch {
      return this.#denyDecision(WEB_FETCH_POLICY_FAIL_CLOSED_REASON);
    }
  }

  async #handlePreToolUseStringPolicy(options: {
    input: PreToolUseHookInput;
    auditWriter?: ToolAuditSink;
    toolNames: ReadonlySet<string>;
    argName: string;
    evaluate: (value: string) => ToolPolicyDecision | Promise<ToolPolicyDecision>;
    failClosedReason: string;
  }): Promise<PreToolUseDecisionResult> {
    if (!options.toolNames.has(options.input.toolName)) {
      return PRE_TOOL_USE_NOT_HANDLED;
    }

    let value = "";

    try {
      value = this.#extractHookStringArg(options.input.toolArgs, options.argName);

      if (!value) {
        options.auditWriter?.append(this.#buildAuditEntry({
          tool: options.input.toolName,
          decision: "allow",
          reason: EMPTY_TOOL_ARGS_DEFERRED_REASON,
          args: this.#buildStringArgs(options.argName, "")
        }));

        return;
      }

      const decision = await options.evaluate(value);

      options.auditWriter?.append(this.#buildAuditEntry(
        this.#buildPolicyDecisionRecord(
          options.input.toolName,
          this.#buildStringArgs(options.argName, value),
          decision
        )
      ));

      return decision;
    } catch {
      const decision = this.#denyDecision(options.failClosedReason);

      options.auditWriter?.append(this.#buildAuditEntry(
        this.#buildPolicyDecisionRecord(
          options.input.toolName,
          this.#buildStringArgs(options.argName, value),
          decision
        )
      ));

      return decision;
    }
  }

  // --- Per-kind permission evaluators ---
  // Each method extracts request args and returns a HandlerDecisionRecord.
  // Adding a new SDK permission kind requires only a new evaluator + a dispatch entry.

  #evaluateRead(
    request: Record<string, unknown>,
    profile: ToolPolicyBoundaryContext
  ): HandlerDecisionRecord {
    const readPath = typeof request.path === "string" ? request.path : undefined;

    if (readPath !== undefined && isAllowedReviewReadPath(readPath, profile.repoRoot)) {
      return { tool: "read", decision: "allow", args: { path: readPath } };
    }

    return {
      tool: "read",
      decision: "deny",
      reason: "Read path is outside the allowed boundary.",
      args: readPath !== undefined ? { path: readPath } : {}
    };
  }

  #evaluateWrite(
    request: Record<string, unknown>
  ): HandlerDecisionRecord {
    const fileName =
      "fileName" in request && typeof request.fileName === "string"
        ? request.fileName
        : undefined;

    return {
      tool: "write",
      decision: "deny",
      reason: "Write operations are not permitted in review sessions.",
      args: fileName !== undefined ? { path: fileName } : {}
    };
  }

  #evaluateShell(
    request: Record<string, unknown>,
    profile: ToolPolicyBoundaryContext
  ): HandlerDecisionRecord {
    const fullCommandText =
      typeof request.fullCommandText === "string"
        ? request.fullCommandText
        : "";
    const args = fullCommandText
      ? this.#buildStringArgs("fullCommandText", fullCommandText)
      : {};

    if (!fullCommandText) {
      return { tool: "shell", decision: "allow", args };
    }

    return this.#buildPolicyDecisionRecord(
      "shell",
      args,
      this.#evaluateShellPolicyDecision(fullCommandText, profile)
    );
  }

  async #evaluateUrl(
    request: Record<string, unknown>
  ): Promise<HandlerDecisionRecord> {
    const url = typeof request.url === "string" ? request.url : "";
    const args = url ? this.#buildStringArgs("url", url) : {};

    if (!url) {
      return { tool: "url", decision: "allow", args };
    }

    return this.#buildPolicyDecisionRecord(
      "url",
      args,
      await this.#evaluateUrlPolicyDecision(url)
    );
  }

  #evaluateMcp(
    request: Record<string, unknown>
  ): HandlerDecisionRecord {
    const serverName =
      typeof request.serverName === "string" ? request.serverName : undefined;
    const toolName =
      typeof request.toolName === "string" ? request.toolName : undefined;
    const args: Record<string, string | undefined> = {};
    if (serverName !== undefined) args.serverName = serverName;
    if (toolName !== undefined) args.toolName = toolName;

    return { tool: "mcp", decision: "allow", args };
  }

  #evaluateCustomTool(
    request: Record<string, unknown>
  ): HandlerDecisionRecord {
    const toolName =
      typeof request.toolName === "string" ? request.toolName : undefined;
    const args: Record<string, string | undefined> = {};
    if (toolName !== undefined) args.toolName = toolName;

    return { tool: "custom-tool", decision: "deny", reason: CUSTOM_TOOL_DENY_REASON, args };
  }

  #evaluateMemory(
    request: Record<string, unknown>
  ): HandlerDecisionRecord {
    // Defensive: memory kind (not in SDK PermissionRequest.kind union,
    // but exists in session-events.d.ts). Low-risk; approve.
    const subject =
      typeof request.subject === "string" ? request.subject : undefined;
    const args: Record<string, string | undefined> = {};
    if (subject !== undefined) args.subject = subject;

    return { tool: "memory", decision: "allow", args };
  }

  #evaluateHook(
    request: Record<string, unknown>
  ): HandlerDecisionRecord {
    // Defensive: hook kind (not in SDK PermissionRequest.kind union).
    // Unknown security implications; fail-closed deny.
    const toolName =
      typeof request.toolName === "string" ? request.toolName : undefined;
    const args: Record<string, string | undefined> = {};
    if (toolName !== undefined) args.toolName = toolName;

    return { tool: "hook", decision: "deny", reason: HOOK_DENY_REASON, args };
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
    profile: ToolPolicyBoundaryContext,
    auditWriter?: ToolAuditSink
  ): PermissionHandler {
    return async (request) => {
      let record: HandlerDecisionRecord;

      if (request.kind === "read") {
        record = this.#evaluateRead(request, profile);
      } else if (request.kind === "write") {
        record = this.#evaluateWrite(request);
      } else if (request.kind === "shell") {
        record = this.#evaluateShell(request, profile);
      } else if (request.kind === "url") {
        record = await this.#evaluateUrl(request);
      } else if (request.kind === "mcp") {
        record = this.#evaluateMcp(request);
      } else if (request.kind === "custom-tool") {
        record = this.#evaluateCustomTool(request);
      } else if (request.kind === "memory") {
        record = this.#evaluateMemory(request);
      } else if (request.kind === "hook") {
        record = this.#evaluateHook(request);
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
    profile: ToolPolicyBoundaryContext,
    auditWriter?: ToolAuditSink
  ): PreToolUseHook {
    return async (input: PreToolUseHookInput): Promise<PreToolUseHookResult> => {
      const urlResult = await this.#handlePreToolUseStringPolicy({
        input,
        auditWriter,
        toolNames: URL_TOOL_NAMES,
        argName: "url",
        evaluate: (url) => this.#evaluateUrlPolicyDecision(url),
        failClosedReason: WEB_FETCH_POLICY_FAIL_CLOSED_REASON
      });

      if (urlResult !== PRE_TOOL_USE_NOT_HANDLED) {
        return urlResult;
      }

      const shellResult = await this.#handlePreToolUseStringPolicy({
        input,
        auditWriter,
        toolNames: SHELL_TOOL_NAMES,
        argName: "command",
        evaluate: (command) =>
          this.#evaluateShellPolicyDecision(command, profile, input.cwd),
        failClosedReason: SHELL_POLICY_FAIL_CLOSED_REASON
      });

      if (shellResult !== PRE_TOOL_USE_NOT_HANDLED) {
        return shellResult;
      }

      return;
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
