import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock } from "node:test";
import test from "node:test";

import {
  READONLY_BASH_DENY_REASON,
  SHELL_POLICY_FAIL_CLOSED_REASON,
  UNSAFE_WEB_FETCH_URL_REASON,
  CUSTOM_TOOL_DENY_REASON,
  UNKNOWN_KIND_DENY_REASON
} from "../../src/services/tool-policy-guard.ts";
import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
import {
  createPolicySession,
  FakeRedirectResolver,
  readAuditLines
} from "../helpers/tool-policy-fixture.ts";

// The guard exposes two surfaces: the `hook` (onPreToolUse) short-circuits
// tool execution before the SDK calls the tool, while the `handler`
// (onPermissionRequest) responds to the read/write permission model.
// This test validates the handler's read/write boundary independently.
test("tool policy guard permission handler allows repo-local reads and denies out-of-bound reads and writes", async () => {
  const { handler } = createPolicySession();

  assert.deepEqual(
    await handler(
      { kind: "read", path: "/workspace/repo/src/app.ts" },
      { sessionId: "session-1" }
    ),
    { kind: "approved" }
  );
  assert.deepEqual(
    await handler(
      { kind: "read", path: "/workspace/repo/.nightowl/review/run/files/a.md" },
      { sessionId: "session-1" }
    ),
    { kind: "approved" }
  );
  assert.deepEqual(
    await handler(
      { kind: "read", path: "/workspace/repo/.nightowl/reviewconfig.json" },
      { sessionId: "session-1" }
    ),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );
  assert.deepEqual(
    await handler(
      { kind: "read", path: "/tmp/secret.txt" },
      { sessionId: "session-1" }
    ),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );
  assert.deepEqual(
    await handler(
      { kind: "write", fileName: "/workspace/repo/src/app.ts" },
      { sessionId: "session-1" }
    ),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );
});

test("tool policy guard keeps representative web_fetch allow and deny behavior through the hook surface", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://localhost:3000" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
    }
  );
});

test("tool policy guard keeps representative shell allow and deny behavior through the hook surface", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git diff main...feature-branch --name-status" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "curl https://example.com" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

// Missing toolArgs must deny conservatively rather than allowing by default;
// a malformed or truncated call must not silently pass as allowed.
test("tool policy guard passes through non-bash and non-web_fetch tools and handles missing toolArgs conservatively", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "view",
        toolArgs: { file: "src/app.ts" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: undefined
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: undefined
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
    }
  );
});

test("tool policy guard writes audit records for representative pre-tool decisions", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline -5" }
      },
      { sessionId: "s1" }
    );
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://localhost:8080" }
      },
      { sessionId: "s1" }
    );

    const [allowRecord, denyRecord] = readAuditLines(auditPath);

    assert.equal(allowRecord.tool, "bash");
    assert.equal(allowRecord.decision, "allow");
    assert.equal(allowRecord.args.command, "git log --oneline -5");
    assert.equal("reason" in allowRecord, false);
    assert.equal(denyRecord.tool, "web_fetch");
    assert.equal(denyRecord.decision, "deny");
    assert.equal(denyRecord.args.url, "http://localhost:8080");
    assert.equal(denyRecord.reason, UNSAFE_WEB_FETCH_URL_REASON);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard writes audit records for redirect-policy denials", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({
      auditWriter,
      redirectResolver: new FakeRedirectResolver({
        kind: "denied",
        reason: "Review sessions only allow web_fetch when redirect chains resolve safely."
      })
    });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/start" }
      },
      { sessionId: "s1" }
    );

    const [denyRecord] = readAuditLines(auditPath);

    assert.equal(denyRecord.tool, "web_fetch");
    assert.equal(denyRecord.decision, "deny");
    assert.equal(
      denyRecord.reason,
      "Review sessions only allow web_fetch when redirect chains resolve safely."
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard writes audit records for permission decisions", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { handler } = createPolicySession({ auditWriter });

    await handler(
      { kind: "read", path: "/workspace/repo/src/app.ts" },
      { sessionId: "s1" }
    );
    await handler(
      { kind: "read", path: "/tmp/secret.txt" },
      { sessionId: "s1" }
    );
    await handler(
      { kind: "write", fileName: "/workspace/repo/src/app.ts" },
      { sessionId: "s1" }
    );

    const [readAllow, readDeny, writeDeny] = readAuditLines(auditPath);

    assert.equal(readAllow.tool, "read");
    assert.equal(readAllow.decision, "allow");
    assert.equal(readDeny.tool, "read");
    assert.equal(readDeny.decision, "deny");
    assert.equal(readDeny.reason, "Read path is outside the allowed boundary.");
    assert.equal(writeDeny.tool, "write");
    assert.equal(writeDeny.decision, "deny");
    assert.equal(
      writeDeny.reason,
      "Write operations are not permitted in review sessions."
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard permission handler approves shell kind and writes audit record", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { handler } = createPolicySession({ auditWriter });

    assert.deepEqual(
      await handler({ kind: "shell" }, { sessionId: "s1" }),
      { kind: "approved" }
    );

    const [record] = readAuditLines(auditPath);
    assert.equal(record.tool, "shell");
    assert.equal(record.decision, "allow");
    assert.deepEqual(record.args, {});
    assert.equal(typeof record.ts, "string");
    assert.equal("reason" in record, false);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard permission handler approves url kind and writes audit record", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { handler } = createPolicySession({ auditWriter });

    assert.deepEqual(
      await handler({ kind: "url" }, { sessionId: "s1" }),
      { kind: "approved" }
    );

    const [record] = readAuditLines(auditPath);
    assert.equal(record.tool, "url");
    assert.equal(record.decision, "allow");
    assert.deepEqual(record.args, {});
    assert.equal(typeof record.ts, "string");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard permission handler approves mcp kind and writes audit record", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { handler } = createPolicySession({ auditWriter });

    assert.deepEqual(
      await handler({ kind: "mcp" }, { sessionId: "s1" }),
      { kind: "approved" }
    );

    const [record] = readAuditLines(auditPath);
    assert.equal(record.tool, "mcp");
    assert.equal(record.decision, "allow");
    assert.deepEqual(record.args, {});
    assert.equal(typeof record.ts, "string");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard permission handler denies custom-tool kind and writes audit record", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { handler } = createPolicySession({ auditWriter });

    assert.deepEqual(
      await handler({ kind: "custom-tool" }, { sessionId: "s1" }),
      { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
    );

    const [record] = readAuditLines(auditPath);
    assert.equal(record.tool, "custom-tool");
    assert.equal(record.decision, "deny");
    assert.equal(record.reason, CUSTOM_TOOL_DENY_REASON);
    assert.deepEqual(record.args, {});
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard permission handler denies unknown kind 'memory' and writes audit record with actual kind", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { handler } = createPolicySession({ auditWriter });

    assert.deepEqual(
      await handler(
        { kind: "memory" as "shell" },
        { sessionId: "s1" }
      ),
      { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
    );

    const [record] = readAuditLines(auditPath);
    assert.equal(record.tool, "memory");
    assert.equal(record.decision, "deny");
    assert.equal(record.reason, UNKNOWN_KIND_DENY_REASON);
    assert.deepEqual(record.args, {});
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard permission handler denies unknown kind 'something-new' with dynamic tool field", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { handler } = createPolicySession({ auditWriter });

    assert.deepEqual(
      await handler(
        { kind: "something-new" as "shell" },
        { sessionId: "s1" }
      ),
      { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
    );

    const [record] = readAuditLines(auditPath);
    assert.equal(record.tool, "something-new");
    assert.equal(record.decision, "deny");
    assert.equal(record.reason, UNKNOWN_KIND_DENY_REASON);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard permission handler works correctly for new kinds without auditWriter", async () => {
  const { handler } = createPolicySession();

  assert.deepEqual(
    await handler({ kind: "shell" }, { sessionId: "s1" }),
    { kind: "approved" }
  );
  assert.deepEqual(
    await handler({ kind: "custom-tool" }, { sessionId: "s1" }),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );
  assert.deepEqual(
    await handler(
      { kind: "memory" as "shell" },
      { sessionId: "s1" }
    ),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );
});

test("tool policy guard behaves normally without an audit writer", async () => {
  const { hook, handler } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
  assert.deepEqual(
    await handler(
      { kind: "read", path: "/workspace/repo/src/app.ts" },
      { sessionId: "s1" }
    ),
    { kind: "approved" }
  );
});

test("tool policy guard keeps shell tool-name alias behavior through the hook surface", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: { command: "git log --oneline" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "shell",
        toolArgs: { command: "git log --oneline" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: { command: "rm -rf /" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: undefined
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "shell",
        toolArgs: undefined
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

test("tool policy guard shell alias audit records keep the original toolName", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-shell-names-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "sh",
        toolArgs: { command: "git log --oneline" }
      },
      { sessionId: "s1" }
    );
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "shell",
        toolArgs: { command: "rm -rf /" }
      },
      { sessionId: "s1" }
    );

    const [shRecord, shellRecord] = readAuditLines(auditPath);

    assert.equal(shRecord.tool, "sh");
    assert.equal(shellRecord.tool, "shell");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard fails closed when shell policy evaluation throws an Error or non-Error", async () => {
  const { hook } = createPolicySession();

  mock.method(path, "resolve", () => {
    throw new Error("simulated path.resolve failure");
  });

  try {
    assert.deepEqual(
      await hook(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "bash",
          toolArgs: { command: "git log /workspace/repo" }
        },
        { sessionId: "s1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason: SHELL_POLICY_FAIL_CLOSED_REASON
      }
    );
  } finally {
    mock.restoreAll();
  }

  mock.method(path, "resolve", () => {
    throw "non-error string thrown";
  });

  try {
    assert.deepEqual(
      await hook(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "bash",
          toolArgs: { command: "git log /workspace/repo" }
        },
        { sessionId: "s1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason: SHELL_POLICY_FAIL_CLOSED_REASON
      }
    );
  } finally {
    mock.restoreAll();
  }
});

test("tool policy guard writes fail-closed audit records with extracted and missing commands", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-failclosed-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    mock.method(path, "resolve", () => {
      throw new Error("simulated path.resolve failure");
    });

    try {
      await hook(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "bash",
          toolArgs: { command: "git log /workspace/repo" }
        },
        { sessionId: "s1" }
      );
    } finally {
      mock.restoreAll();
    }

    const throwingProxy = new Proxy({} as Record<string, unknown>, {
      has(): never {
        throw new Error("has trap throws");
      }
    });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: throwingProxy
      },
      { sessionId: "s1" }
    );

    const [recordWithCommand, recordWithoutCommand] = readAuditLines(auditPath);

    assert.equal(recordWithCommand.reason, SHELL_POLICY_FAIL_CLOSED_REASON);
    assert.equal(recordWithCommand.args.command, "git log /workspace/repo");
    assert.equal(recordWithoutCommand.reason, SHELL_POLICY_FAIL_CLOSED_REASON);
    assert.equal(recordWithoutCommand.args.command, "");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("tool policy guard keeps normal deny reasons distinct from fail-closed and leaves web_fetch unaffected", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "curl http://example.com" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy guard leaves unknown tool names outside the shell policy boundary", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "python",
        toolArgs: { command: "import os; os.system('rm -rf /')" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});
