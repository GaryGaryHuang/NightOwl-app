import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
import { createPolicySession, readAuditLines } from "../helpers/tool-policy-fixture.ts";

// Pipeline exception tests (Tasks 1.1 + 1.3)

test("tool policy bash pipeline allows two-segment pipeline with whitelisted commands", async () => {
  // (a) simple two-segment pipeline
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline | head -20" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows three-segment pipeline with whitelisted commands", async () => {
  // (b) three-segment pipeline
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'git diff HEAD~1 | grep "function" | wc -l' }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows pipeline with extra whitespace around pipe operators", async () => {
  // (c) extra whitespace around pipes
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline  |  head -20" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows pipeline with no whitespace around pipe operator", async () => {
  // (d) no whitespace around pipe
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log|head" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline denies pipeline where one segment is not whitelisted", async () => {
  // (e) non-whitelisted segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline | curl http://example.com" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline where one segment has a path outside the allowed boundary", async () => {
  // (f) out-of-boundary path in segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "cat /etc/passwd | head -5" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline where one segment has a dangerous flag", async () => {
  // (g) dangerous flag in segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log --oneline | sort --output=result.txt" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline with empty segment from trailing pipe", async () => {
  // (h) trailing pipe produces empty segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log |" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline with empty segment from leading pipe", async () => {
  // (i) leading pipe produces empty segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "| head -5" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies pipeline with only whitespace segment", async () => {
  // (j) whitespace-only middle segment
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log |   | head" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies logical OR syntax", async () => {
  // (k) || logical OR
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git status || echo fail" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies logical OR mixed with pipeline", async () => {
  // (l) || mixed with pipeline
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git log || true | head" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline allows double-quoted regex alternation containing literal pipe", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep -E "foo|bar"' }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows single-quoted regex alternation containing literal pipe", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "grep -E 'foo|bar'" }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows escaped literal pipe within one segment", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: String.raw`grep foo\|bar` }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows quoted literal pipe alongside a real top-level pipeline separator", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'git diff HEAD~1 | grep -E "foo|bar" | head -5' }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline allows repo-relative path token when tool cwd is repo root", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep -E "foo|bar" src/file.ts' }
      },
      { sessionId: "s1" }
    ),
    undefined
  );
});

test("tool policy bash pipeline denies repo-relative path token when tool cwd is outside allowed boundary", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/tmp",
        toolName: "bash",
        toolArgs: { command: 'grep -E "foo|bar" src/file.ts' }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies unterminated double quote conservatively", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep -E "foo|bar' }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies unterminated single quote conservatively", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "grep -E 'foo|bar" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline denies dangling escape at end of command conservatively", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "grep foo\\" }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline keeps quoted double-pipe denied as unchanged lexical guardrail", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep "foo||bar"' }
      },
      { sessionId: "s1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("tool policy bash pipeline writes correct audit records for quoted and denied commands", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-pipeline-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const auditWriter = new ToolAuditWriter(auditPath);
    const { hook } = createPolicySession({ auditWriter });

    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'git diff HEAD~1 | grep -E "foo|bar" | head -5' }
      },
      { sessionId: "s1" }
    );
    await hook(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: 'grep "foo||bar"' }
      },
      { sessionId: "s1" }
    );

    const [allowRecord, denyRecord] = readAuditLines(auditPath);

    assert.equal(allowRecord.tool, "bash");
    assert.equal(allowRecord.decision, "allow");
    assert.equal(allowRecord.args.command, 'git diff HEAD~1 | grep -E "foo|bar" | head -5');
    assert.equal("reason" in allowRecord, false);

    assert.equal(denyRecord.tool, "bash");
    assert.equal(denyRecord.decision, "deny");
    assert.equal(
      denyRecord.reason,
      "Review sessions only allow repo-local read-only bash analysis commands."
    );
    assert.equal(denyRecord.args.command, 'grep "foo||bar"');
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
