import assert from "node:assert/strict";
import test from "node:test";

import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
import {
  createAuditFileFixture,
  createToolAuditRecord
} from "../helpers/review-session-runtime-contract-fixture.ts";

function readAuditLines(auditContent: string): unknown[] {
  return auditContent
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("ToolAuditWriter.append() serializes audit records as JSONL and preserves allow/deny reason semantics", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter(auditFixture.auditPath);
    const records = [
      createToolAuditRecord({
        tool: "url",
        args: { url: "https://docs.example.com" }
      }),
      createToolAuditRecord({
        decision: "deny",
        reason: "Side-effect characters detected: ;",
        args: { command: "git log; rm -rf /" }
      })
    ];

    for (const record of records) {
      writer.append(record);
    }

    const [allowRecord, denyRecord] = readAuditLines(auditFixture.read()) as Array<{
      ts: string;
      tool: string;
      decision: string;
      reason?: string;
      args: Record<string, string | undefined>;
    }>;

    assert.equal(allowRecord.ts, records[0].ts);
    assert.equal(allowRecord.tool, "url");
    assert.equal(allowRecord.decision, "allow");
    assert.deepEqual(allowRecord.args, { url: "https://docs.example.com" });
    assert.equal("reason" in allowRecord, false);

    assert.equal(denyRecord.ts, records[1].ts);
    assert.equal(denyRecord.tool, "shell");
    assert.equal(denyRecord.decision, "deny");
    assert.equal(denyRecord.reason, "Side-effect characters detected: ;");
    assert.deepEqual(denyRecord.args, { command: "git log; rm -rf /" });
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.append() multiple calls produce multiple independently parseable JSONL lines", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter(auditFixture.auditPath);
    const records = [
      createToolAuditRecord({ args: { command: "git log" } }),
      createToolAuditRecord({
        ts: "2026-03-24T10:00:01.000Z",
        tool: "url",
        decision: "deny",
        reason: "private IP",
        args: { url: "http://localhost" }
      }),
      createToolAuditRecord({
        ts: "2026-03-24T10:00:02.000Z",
        tool: "read",
        args: { path: "/repo/src/index.ts" }
      })
    ];

    for (const record of records) {
      writer.append(record);
    }

    const lines = readAuditLines(auditFixture.read()) as Array<{
      ts: string;
      tool: string;
      decision: string;
    }>;

    assert.equal(lines.length, 3);

    for (let index = 0; index < lines.length; index++) {
      const parsed = lines[index];
      assert.equal(parsed.ts, records[index].ts);
      assert.equal(parsed.tool, records[index].tool);
      assert.equal(parsed.decision, records[index].decision);
    }
  } finally {
    auditFixture.cleanup();
  }
});

// ToolAuditWriter must never throw on write failures — a broken audit log
// must not interrupt a running review session.
test("ToolAuditWriter.append() silently ignores write failures and never throws", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const unwritablePaths = [
      "/nonexistent/deeply/nested/tool-audit.jsonl",
      auditFixture.tempDir
    ];

    for (const auditPath of unwritablePaths) {
      const writer = new ToolAuditWriter(auditPath);

      assert.doesNotThrow(() => {
        writer.append(
          createToolAuditRecord({
            decision: "deny",
            reason: "test",
            args: { command: "rm -rf /" }
          })
        );
      });
    }
  } finally {
    auditFixture.cleanup();
  }
});
