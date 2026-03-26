import assert from "node:assert/strict";
import test from "node:test";

import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
import {
  createAuditFileFixture,
  createToolAuditRecord
} from "../helpers/review-session-runtime-contract-fixture.ts";

test("ToolAuditWriter.append() writes a valid JSONL line containing ts, tool, decision, and args", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter(auditFixture.auditPath);
    const record = createToolAuditRecord();

    writer.append(record);

    const parsed = JSON.parse(auditFixture.read().trim());

    assert.equal(parsed.ts, record.ts);
    assert.equal(parsed.tool, "bash");
    assert.equal(parsed.decision, "allow");
    assert.deepEqual(parsed.args, { command: "git log --oneline -5" });
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.append() includes reason field for deny records", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter(auditFixture.auditPath);
    const record = createToolAuditRecord({
      decision: "deny",
      reason: "Side-effect characters detected: ;",
      args: { command: "git log; rm -rf /" }
    });

    writer.append(record);

    const parsed = JSON.parse(auditFixture.read().trim());

    assert.equal(parsed.decision, "deny");
    assert.equal(parsed.reason, "Side-effect characters detected: ;");
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.append() omits reason field for allow records", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter(auditFixture.auditPath);
    const record = createToolAuditRecord({
      tool: "web_fetch",
      args: { url: "https://docs.example.com" }
    });

    writer.append(record);

    const parsed = JSON.parse(auditFixture.read().trim());

    assert.equal(parsed.decision, "allow");
    assert.equal("reason" in parsed, false);
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.append() ts field is ISO 8601 UTC format", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter(auditFixture.auditPath);
    const before = new Date();

    writer.append(
      createToolAuditRecord({
        ts: new Date().toISOString(),
        args: { command: "git status" }
      })
    );

    const after = new Date();
    const parsed = JSON.parse(auditFixture.read().trim());
    const parsedTs = new Date(parsed.ts);

    assert.ok(parsedTs >= before || parsedTs.getTime() >= before.getTime() - 1);
    assert.ok(parsedTs <= after || parsedTs.getTime() <= after.getTime() + 1);
    assert.ok(parsed.ts.endsWith("Z"), `expected ts to end with Z, got: ${parsed.ts}`);
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
        tool: "web_fetch",
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

    const lines = auditFixture.read().split("\n").filter((line) => line.length > 0);

    assert.equal(lines.length, 3);

    for (let index = 0; index < lines.length; index++) {
      const parsed = JSON.parse(lines[index]);
      assert.equal(parsed.ts, records[index].ts);
      assert.equal(parsed.tool, records[index].tool);
      assert.equal(parsed.decision, records[index].decision);
    }
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.append() silently ignores write failures and does not throw", () => {
  const writer = new ToolAuditWriter("/nonexistent/deeply/nested/tool-audit.jsonl");

  assert.doesNotThrow(() => {
    writer.append(createToolAuditRecord({ args: { command: "git log" } }));
  });
});

test("ToolAuditWriter.append() does not propagate errors when file path is read-only", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter(auditFixture.tempDir);

    assert.doesNotThrow(() => {
      writer.append(
        createToolAuditRecord({
          decision: "deny",
          reason: "test",
          args: { command: "rm -rf /" }
        })
      );
    });
  } finally {
    auditFixture.cleanup();
  }
});
