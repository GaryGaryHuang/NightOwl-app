import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { ToolAuditSink } from "../../src/services/tool-audit-writer.ts";
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

test("ToolAuditWriter.append() preserves records as newline-delimited JSON in append order", () => {
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

    const auditRecords = readAuditLines(auditFixture.read()) as Array<{
      ts: string;
      tool: string;
      decision: string;
      reason?: string;
      args: Record<string, string | undefined>;
    }>;

    assert.equal(auditRecords.length, records.length);

    const [allowRecord, denyRecord, readRecord] = auditRecords;

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

    assert.equal(readRecord.ts, records[2].ts);
    assert.equal(readRecord.tool, "read");
    assert.equal(readRecord.decision, "allow");
    assert.deepEqual(readRecord.args, { path: "/repo/src/index.ts" });
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
      path.join(auditFixture.tempDir, "missing", "tool-audit.jsonl"),
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

// --- Buffered audit writer tests ---

test("ToolAuditWriter constructed without path enters buffering mode and does not create a file", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter();

    writer.append(createToolAuditRecord({ tool: "shell" }));
    writer.append(createToolAuditRecord({ tool: "read" }));

    // No file should exist — records are held in memory
    assert.equal(existsSync(auditFixture.auditPath), false);
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.setPath() flushes buffered records in append order", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter();

    const r1 = createToolAuditRecord({ tool: "shell", args: { command: "git status" } });
    const r2 = createToolAuditRecord({ tool: "read", args: { path: "/src/index.ts" } });
    const r3 = createToolAuditRecord({ tool: "url", args: { url: "https://example.com" } });

    writer.append(r1);
    writer.append(r2);
    writer.append(r3);

    writer.setPath(auditFixture.auditPath);

    const lines = readAuditLines(auditFixture.read());
    assert.equal(lines.length, 3);
    assert.deepEqual(lines[0], r1);
    assert.deepEqual(lines[1], r2);
    assert.deepEqual(lines[2], r3);
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.append() after setPath() writes directly to disk", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter();

    const buffered = createToolAuditRecord({ tool: "shell" });
    writer.append(buffered);

    writer.setPath(auditFixture.auditPath);

    const direct = createToolAuditRecord({ tool: "read", args: { path: "/a.ts" } });
    writer.append(direct);

    const lines = readAuditLines(auditFixture.read());
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], buffered);
    assert.deepEqual(lines[1], direct);
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.setPath() throws on second call", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter();
    writer.setPath(auditFixture.auditPath);

    assert.throws(
      () => writer.setPath(path.join(auditFixture.tempDir, "other.jsonl")),
      { message: "setPath() can only be called once" }
    );
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.setPath() throws on direct-write mode instance", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter(auditFixture.auditPath);

    assert.throws(
      () => writer.setPath(path.join(auditFixture.tempDir, "other.jsonl")),
      { message: "setPath() can only be called once" }
    );
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.setPath() flush failure does not prevent mode switch", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter();

    writer.append(createToolAuditRecord({ tool: "shell" }));
    writer.append(createToolAuditRecord({ tool: "read" }));

    // Use a directory path (not a file) — appendFileSync will fail for each record
    assert.doesNotThrow(() => writer.setPath(auditFixture.tempDir));

    // Writer should now be in direct-write mode; subsequent append should not throw
    assert.doesNotThrow(() =>
      writer.append(createToolAuditRecord({ tool: "url" }))
    );
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter in buffering mode satisfies ToolAuditSink interface", () => {
  // Compile-time verification: buffered writer is assignable to ToolAuditSink
  const sink: ToolAuditSink = new ToolAuditWriter();
  sink.append(createToolAuditRecord());
});

test("ToolAuditWriter in direct-write mode satisfies ToolAuditSink interface", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const sink: ToolAuditSink = new ToolAuditWriter(auditFixture.auditPath);
    sink.append(createToolAuditRecord());
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.setPath() never called: buffered records are not written to any file", () => {
  const auditFixture = createAuditFileFixture();

  try {
    // Create writer, add records, then let it go out of scope without setPath
    const writer = new ToolAuditWriter();
    writer.append(createToolAuditRecord({ tool: "shell" }));
    writer.append(createToolAuditRecord({ tool: "read" }));

    // No file should exist
    assert.equal(existsSync(auditFixture.auditPath), false);

    // The writer instance still exists here; this just verifies no side effects occurred
    void writer;
  } finally {
    auditFixture.cleanup();
  }
});
