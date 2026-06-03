import path from "node:path";

import {
  type PermissionHandler,
  type PermissionRequest,
  type SessionConfig
} from "@github/copilot-sdk";

import { reviewOutputRoot as buildReviewOutputRoot } from "../../core/nightowl-namespace.ts";
import {
  canonicalizeReviewBoundaryPath,
  isAllowedReviewReadPath
} from "../../core/review-access-guard.ts";
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
  ToolPolicyDecision
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
const EXTENSION_MANAGEMENT_DENY_REASON =
  "Extension management is not permitted in review sessions.";
const EXTENSION_PERMISSION_ACCESS_DENY_REASON =
  "Extension permission access is not permitted in review sessions.";
const UNKNOWN_KIND_DENY_REASON =
  "Unknown permission kind is not permitted in review sessions.";
const EMPTY_TOOL_ARGS_DEFERRED_REASON =
  "Empty toolArgs; deferred to permissionHandler.";
const WEB_FETCH_POLICY_FAIL_CLOSED_REASON =
  "URL policy evaluation failed; denied as a precaution.";
const READ_PATH_INVALID_DENY_REASON =
  "Read permission request did not include a valid path.";
const READ_PATH_BOUNDARY_DENY_REASON =
  "Read path is outside the allowed review source boundary. For repository files, retry with a repo-relative `view.path`; do not pass absolute paths.";
const READ_REVIEW_ARTIFACT_DENY_REASON =
  "On-disk `.nightowl/review/**` artifacts are not retrievable review evidence. Use only the review state supplied by the host for the current run.";

type HandlerDecisionRecord = {
  tool: string;
  decision: "allow" | "deny";
  reason?: string;
  args: Record<string, string | undefined>;
};
type PermissionRequestPayload = PermissionRequest & Record<string, unknown>;

export type ToolPolicyGuardOptions = ToolPolicyWebFetchPolicyOptions;

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

  #denyDecision(reason: string): ToolPolicyDecision {
    return {
      permissionDecision: "deny",
      permissionDecisionReason: reason
    };
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

  async #handlePreToolUseStringPolicy(
    input: PreToolUseHookInput,
    auditWriter: ToolAuditSink | undefined,
    argName: string,
    evaluate: (value: string) => ToolPolicyDecision | Promise<ToolPolicyDecision>,
    failClosedReason: string
  ): Promise<PreToolUseHookResult> {
    let value = "";

    try {
      value = this.#extractHookStringArg(input.toolArgs, argName);

      if (!value) {
        auditWriter?.append(this.#buildAuditEntry({
          tool: input.toolName,
          decision: "allow",
          reason: EMPTY_TOOL_ARGS_DEFERRED_REASON,
          args: { [argName]: "" }
        }));

        return;
      }

      const decision = await evaluate(value);
      const args = { [argName]: value };

      auditWriter?.append(this.#buildAuditEntry(
        this.#buildPolicyDecisionRecord(
          input.toolName,
          args,
          decision
        )
      ));

      return decision;
    } catch {
      const decision = this.#denyDecision(failClosedReason);
      const args = { [argName]: value };

      auditWriter?.append(this.#buildAuditEntry(
        this.#buildPolicyDecisionRecord(
          input.toolName,
          args,
          decision
        )
      ));

      return decision;
    }
  }

  #evaluateRead(
    request: PermissionRequestPayload,
    profile: ToolPolicyBoundaryContext
  ): HandlerDecisionRecord {
    const readPath = typeof request.path === "string" ? request.path : undefined;

    if (readPath === undefined) {
      return {
        tool: "read",
        decision: "deny",
        reason: READ_PATH_INVALID_DENY_REASON,
        args: {}
      };
    }

    try {
      if (isAllowedReviewReadPath(readPath, profile)) {
        return { tool: "read", decision: "allow", args: { path: readPath } };
      }
    } catch {
      // Fail closed when the shared read-boundary helper rejects invalid input
      // or cannot canonicalize the path safely.
    }

    return {
      tool: "read",
      decision: "deny",
      reason: isReviewArtifactReadPath(readPath, profile)
        ? READ_REVIEW_ARTIFACT_DENY_REASON
        : READ_PATH_BOUNDARY_DENY_REASON,
      args: { path: readPath }
    };
  }

  #evaluateWrite(
    request: PermissionRequestPayload
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
    request: PermissionRequestPayload,
    profile: ToolPolicyBoundaryContext
  ): HandlerDecisionRecord {
    const fullCommandText =
      typeof request.fullCommandText === "string"
        ? request.fullCommandText
        : "";
    const args = fullCommandText
      ? { fullCommandText }
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
    request: PermissionRequestPayload
  ): Promise<HandlerDecisionRecord> {
    const url = typeof request.url === "string" ? request.url : "";
    const args = url ? { url } : {};

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
    request: PermissionRequestPayload
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
    request: PermissionRequestPayload
  ): HandlerDecisionRecord {
    const toolName =
      typeof request.toolName === "string" ? request.toolName : undefined;
    const args: Record<string, string | undefined> = {};
    if (toolName !== undefined) args.toolName = toolName;

    return { tool: "custom-tool", decision: "deny", reason: CUSTOM_TOOL_DENY_REASON, args };
  }

  #evaluateMemory(
    request: PermissionRequestPayload
  ): HandlerDecisionRecord {
    const subject =
      typeof request.subject === "string" ? request.subject : undefined;
    const args: Record<string, string | undefined> = {};
    if (subject !== undefined) args.subject = subject;

    return { tool: "memory", decision: "allow", args };
  }

  #evaluateHook(
    request: PermissionRequestPayload
  ): HandlerDecisionRecord {
    // Unknown security implications; fail-closed deny.
    const toolName =
      typeof request.toolName === "string" ? request.toolName : undefined;
    const args: Record<string, string | undefined> = {};
    if (toolName !== undefined) args.toolName = toolName;

    return { tool: "hook", decision: "deny", reason: HOOK_DENY_REASON, args };
  }

  #evaluateExtensionManagement(
    request: PermissionRequestPayload
  ): HandlerDecisionRecord {
    const extensionName =
      typeof request.extensionName === "string" ? request.extensionName : undefined;
    const operation =
      typeof request.operation === "string" ? request.operation : undefined;
    const args: Record<string, string | undefined> = {};
    if (extensionName !== undefined) args.extensionName = extensionName;
    if (operation !== undefined) args.operation = operation;

    return {
      tool: "extension-management",
      decision: "deny",
      reason: EXTENSION_MANAGEMENT_DENY_REASON,
      args
    };
  }

  #evaluateExtensionPermissionAccess(
    request: PermissionRequestPayload
  ): HandlerDecisionRecord {
    const extensionName =
      typeof request.extensionName === "string" ? request.extensionName : undefined;
    const capabilities = Array.isArray(request.capabilities)
      ? request.capabilities.filter((capability): capability is string =>
          typeof capability === "string"
        )
      : [];
    const args: Record<string, string | undefined> = {};
    if (extensionName !== undefined) args.extensionName = extensionName;
    if (capabilities.length > 0) args.capabilities = capabilities.join(",");

    return {
      tool: "extension-permission-access",
      decision: "deny",
      reason: EXTENSION_PERMISSION_ACCESS_DENY_REASON,
      args
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
    profile: ToolPolicyBoundaryContext,
    auditWriter?: ToolAuditSink
  ): PermissionHandler {
    type PermissionEvaluator = (
      request: PermissionRequestPayload
    ) => HandlerDecisionRecord | Promise<HandlerDecisionRecord>;

    // Registry of per-kind evaluators. The `satisfies` clause covers every kind
    // in the SDK PermissionRequest union; if the SDK adds a new kind, TypeScript
    // reports a compile error here until a matching entry is added.
    const sdkEvaluators = {
      read: (request) => this.#evaluateRead(request, profile),
      write: (request) => this.#evaluateWrite(request),
      shell: (request) => this.#evaluateShell(request, profile),
      url: (request) => this.#evaluateUrl(request),
      mcp: (request) => this.#evaluateMcp(request),
      "custom-tool": (request) => this.#evaluateCustomTool(request),
      memory: (request) => this.#evaluateMemory(request),
      hook: (request) => this.#evaluateHook(request),
      "extension-management": (request) =>
        this.#evaluateExtensionManagement(request),
      "extension-permission-access": (request) =>
        this.#evaluateExtensionPermissionAccess(request)
    } satisfies Record<PermissionRequest["kind"], PermissionEvaluator>;

    // Keep lookup string-indexed so unknown future runtime kinds fail closed
    // before the SDK type union catches up.
    const evaluators: { [kind: string]: PermissionEvaluator | undefined } = {
      ...sdkEvaluators
    };

    return async (request) => {
      const requestPayload = request as PermissionRequestPayload;
      const evaluator = evaluators[requestPayload.kind];
      const record: HandlerDecisionRecord = evaluator
        ? await evaluator(requestPayload)
        : {
            tool: requestPayload.kind as string,
            decision: "deny",
            reason: UNKNOWN_KIND_DENY_REASON,
            args: {}
          };

      // Post-dispatch: write the single audit record and return the SDK result.
      // Audit assembly is centralised in #buildAuditEntry so any future field
      // addition only needs to be made in one place.
      auditWriter?.append(this.#buildAuditEntry(record));

      return record.decision === "allow"
        ? { kind: "approve-once" }
        : { kind: "reject", feedback: record.reason };
    };
  }

  buildPreToolUseHook(
    profile: ToolPolicyBoundaryContext,
    auditWriter?: ToolAuditSink
  ): PreToolUseHook {
    return async (input: PreToolUseHookInput): Promise<PreToolUseHookResult> => {
      if (URL_TOOL_NAMES.has(input.toolName)) {
        return this.#handlePreToolUseStringPolicy(
          input,
          auditWriter,
          "url",
          (url) => this.#evaluateUrlPolicyDecision(url),
          WEB_FETCH_POLICY_FAIL_CLOSED_REASON
        );
      }

      if (SHELL_TOOL_NAMES.has(input.toolName)) {
        return this.#handlePreToolUseStringPolicy(
          input,
          auditWriter,
          "command",
          (command) =>
            this.#evaluateShellPolicyDecision(
              command,
              profile,
              input.workingDirectory
            ),
          SHELL_POLICY_FAIL_CLOSED_REASON
        );
      }

      return;
    };
  }
}

function isReviewArtifactReadPath(
  readPath: string,
  profile: ToolPolicyBoundaryContext
): boolean {
  if (!path.isAbsolute(readPath)) {
    return false;
  }

  const reviewRoots = [
    buildReviewOutputRoot(profile.repoRoot),
    profile.reviewOutputRoot
  ].filter(
    (candidate): candidate is string =>
      typeof candidate === "string" &&
      candidate.length > 0 &&
      path.isAbsolute(candidate)
  );

  return reviewRoots.some((reviewRoot) =>
    isPathInsideOrEqualForFeedback(readPath, reviewRoot)
  );
}

function isPathInsideOrEqualForFeedback(
  candidate: string,
  boundary: string
): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedBoundary = path.resolve(boundary);

  if (
    resolvedCandidate === resolvedBoundary ||
    resolvedCandidate.startsWith(`${resolvedBoundary}${path.sep}`)
  ) {
    return true;
  }

  try {
    const canonicalCandidate = canonicalizeReviewBoundaryPath(resolvedCandidate);
    const canonicalBoundary = canonicalizeReviewBoundaryPath(resolvedBoundary);

    return (
      canonicalCandidate === canonicalBoundary ||
      canonicalCandidate.startsWith(`${canonicalBoundary}${path.sep}`)
    );
  } catch {
    return false;
  }
}

export {
  CUSTOM_TOOL_DENY_REASON,
  EMPTY_TOOL_ARGS_DEFERRED_REASON,
  EXTENSION_MANAGEMENT_DENY_REASON,
  EXTENSION_PERMISSION_ACCESS_DENY_REASON,
  HOOK_DENY_REASON,
  READ_PATH_INVALID_DENY_REASON,
  READ_PATH_BOUNDARY_DENY_REASON,
  READ_REVIEW_ARTIFACT_DENY_REASON,
  READONLY_BASH_DENY_REASON,
  SHELL_POLICY_FAIL_CLOSED_REASON,
  UNKNOWN_KIND_DENY_REASON,
  UNSAFE_WEB_FETCH_URL_REASON,
  WEB_FETCH_POLICY_FAIL_CLOSED_REASON
};
