import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
import type { ToolAuditRecord } from "../../src/services/tool-audit-writer.ts";

// ---------------------------------------------------------------------------
// Task 1.2 – ToolAuditWriter: JSONL append behavior
// ---------------------------------------------------------------------------

test("ToolAuditWriter.append() writes a valid JSONL line containing ts, tool, decision, and args", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);

    const record: ToolAuditRecord = {
      ts: "2026-03-24T10:00:00.000Z",
      tool: "bash",
      decision: "allow",
      args: { command: "git log --oneline -5" }
    };

    writer.append(record);

    const content = readFileSync(auditPath, "utf8");
    const parsed = JSON.parse(content.trim());

    assert.equal(parsed.ts, record.ts);
    assert.equal(parsed.tool, "bash");
    assert.equal(parsed.decision, "allow");
    assert.deepEqual(parsed.args, { command: "git log --oneline -5" });
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("ToolAuditWriter.append() includes reason field for deny records", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);

    const record: ToolAuditRecord = {
      ts: "2026-03-24T10:00:00.000Z",
      tool: "bash",
      decision: "deny",
      reason: "Side-effect characters detected: ;",
      args: { command: "git log; rm -rf /" }
    };

    writer.append(record);

    const content = readFileSync(auditPath, "utf8");
    const parsed = JSON.parse(content.trim());

    assert.equal(parsed.decision, "deny");
    assert.equal(parsed.reason, "Side-effect characters detected: ;");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("ToolAuditWriter.append() omits reason field for allow records", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);

    const record: ToolAuditRecord = {
      ts: "2026-03-24T10:00:00.000Z",
      tool: "web_fetch",
      decision: "allow",
      args: { url: "https://docs.example.com" }
    };

    writer.append(record);

    const content = readFileSync(auditPath, "utf8");
    const parsed = JSON.parse(content.trim());

    assert.equal(parsed.decision, "allow");
    assert.equal("reason" in parsed, false);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("ToolAuditWriter.append() ts field is ISO 8601 UTC format", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);

    const before = new Date();
    writer.append({
      ts: new Date().toISOString(),
      tool: "bash",
      decision: "allow",
      args: { command: "git status" }
    });
    const after = new Date();

    const content = readFileSync(auditPath, "utf8");
    const parsed = JSON.parse(content.trim());
    const parsedTs = new Date(parsed.ts);

    assert.ok(parsedTs >= before || parsedTs.getTime() >= before.getTime() - 1);
    assert.ok(parsedTs <= after || parsedTs.getTime() <= after.getTime() + 1);
    // Must end in Z (UTC)
    assert.ok(parsed.ts.endsWith("Z"), `expected ts to end with Z, got: ${parsed.ts}`);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("ToolAuditWriter.append() multiple calls produce multiple independently parseable JSONL lines", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);

    const records: ToolAuditRecord[] = [
      { ts: "2026-03-24T10:00:00.000Z", tool: "bash", decision: "allow", args: { command: "git log" } },
      { ts: "2026-03-24T10:00:01.000Z", tool: "web_fetch", decision: "deny", reason: "private IP", args: { url: "http://localhost" } },
      { ts: "2026-03-24T10:00:02.000Z", tool: "read", decision: "allow", args: { path: "/repo/src/index.ts" } }
    ];

    for (const record of records) {
      writer.append(record);
    }

    const content = readFileSync(auditPath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);

    assert.equal(lines.length, 3);

    for (let i = 0; i < lines.length; i++) {
      const parsed = JSON.parse(lines[i]);
      assert.equal(parsed.ts, records[i].ts);
      assert.equal(parsed.tool, records[i].tool);
      assert.equal(parsed.decision, records[i].decision);
    }
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Task 1.3 – ToolAuditWriter: best-effort error handling
// ---------------------------------------------------------------------------

test("ToolAuditWriter.append() silently ignores write failures and does not throw", () => {
  // Use a path inside a non-existent nested directory to force appendFileSync to fail
  const writer = new ToolAuditWriter("/nonexistent/deeply/nested/tool-audit.jsonl");

  // Must not throw
  assert.doesNotThrow(() => {
    writer.append({
      ts: "2026-03-24T10:00:00.000Z",
      tool: "bash",
      decision: "allow",
      args: { command: "git log" }
    });
  });
});

test("ToolAuditWriter.append() does not propagate errors when file path is read-only", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    // Point at the directory itself (not a file) — appendFileSync on a directory path fails on POSIX
    const writer = new ToolAuditWriter(tempDir);

    assert.doesNotThrow(() => {
      writer.append({
        ts: "2026-03-24T10:00:00.000Z",
        tool: "bash",
        decision: "deny",
        reason: "test",
        args: { command: "rm -rf /" }
      });
    });
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
