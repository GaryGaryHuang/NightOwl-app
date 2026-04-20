import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AuditWriterStateError,
  ReviewRunToolAudit,
  ToolAuditWriter
} from "../../src/services/tool-audit-writer.ts";
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

test("ToolAuditWriter.append() preserves records as newline-delimited JSON in append order", async () => {
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

    await writer.flush();
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

test("ToolAuditWriter reports only the first write failure to the callback with audit path context", async () => {
  const auditFixture = createAuditFileFixture();
  const failures: Array<{ auditFilePath: string | undefined; message: string }> = [];

  try {
    const writer = new ToolAuditWriter(auditFixture.tempDir, {
      onWriteFailure(failure) {
        failures.push({
          auditFilePath: failure.auditFilePath,
          message: failure.error instanceof Error
            ? failure.error.message
            : String(failure.error)
        });
      }
    });

    writer.append(createToolAuditRecord({ tool: "shell" }));
    writer.append(createToolAuditRecord({ tool: "read" }));

    await writer.flush();

    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.auditFilePath, auditFixture.tempDir);
    assert.match(failures[0]?.message ?? "", /EISDIR|illegal operation on a directory/u);
  } finally {
    auditFixture.cleanup();
  }
});

// --- Buffered audit writer tests ---

test("ToolAuditWriter.attachAuditFile() flushes buffered records and then writes directly to disk in append order", async () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter();

    const r1 = createToolAuditRecord({ tool: "shell", args: { command: "git status" } });
    const r2 = createToolAuditRecord({ tool: "read", args: { path: "/src/index.ts" } });

    writer.append(r1);
    writer.append(r2);

    // Before attach: records are buffered, no file created
    assert.equal(existsSync(auditFixture.auditPath), false);

    writer.attachAuditFile(auditFixture.auditPath);

    // After attach: direct-write mode — new records go to disk
    const r3 = createToolAuditRecord({ tool: "url", args: { url: "https://example.com" } });
    writer.append(r3);

    await writer.flush();

    const lines = readAuditLines(auditFixture.read());
    assert.equal(lines.length, 3);
    assert.deepEqual(lines[0], r1);
    assert.deepEqual(lines[1], r2);
    assert.deepEqual(lines[2], r3);
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.attachAuditFile() throws AuditWriterStateError on second call regardless of initial mode", () => {
  const auditFixture = createAuditFileFixture();

  try {
    // Case 1: buffering mode → attach once → second attach throws
    const bufferedWriter = new ToolAuditWriter();
    bufferedWriter.attachAuditFile(auditFixture.auditPath);

    assert.throws(
      () => bufferedWriter.attachAuditFile(path.join(auditFixture.tempDir, "other.jsonl")),
      (err: unknown) => {
        assert.ok(err instanceof AuditWriterStateError);
        assert.equal(err.name, "AuditWriterStateError");
        assert.equal(err.message, "tool audit file can only be attached once");
        return true;
      }
    );

    // Case 2: direct-write mode → attach throws
    const directWriter = new ToolAuditWriter(auditFixture.auditPath);

    assert.throws(
      () => directWriter.attachAuditFile(path.join(auditFixture.tempDir, "other.jsonl")),
      (err: unknown) => {
        assert.ok(err instanceof AuditWriterStateError);
        return true;
      }
    );
  } finally {
    auditFixture.cleanup();
  }
});

test("ToolAuditWriter.attachAuditFile() flush failure does not prevent mode switch", () => {
  const auditFixture = createAuditFileFixture();

  try {
    const writer = new ToolAuditWriter();

    writer.append(createToolAuditRecord({ tool: "shell" }));
    writer.append(createToolAuditRecord({ tool: "read" }));

    // Use a directory path (not a file) — appendFile will fail for each record
    assert.doesNotThrow(() => writer.attachAuditFile(auditFixture.tempDir));

    // Writer should now be in direct-write mode; subsequent append should not throw
    assert.doesNotThrow(() =>
      writer.append(createToolAuditRecord({ tool: "url" }))
    );
  } finally {
    auditFixture.cleanup();
  }
});

test("ReviewRunToolAudit binds buffered sink records to outputTarget.toolAuditPath", async () => {
  const auditFixture = createAuditFileFixture();

  try {
    const toolAudit = new ReviewRunToolAudit();
    const sink = toolAudit.sink;
    const shellRecord = createToolAuditRecord({ tool: "shell" });
    const readRecord = createToolAuditRecord({ tool: "read", args: { path: "/src/index.ts" } });

    sink.append(shellRecord);
    sink.append(readRecord);

    toolAudit.bindOutputTarget({ toolAuditPath: auditFixture.auditPath });
    await toolAudit.flush();

    const lines = readAuditLines(auditFixture.read());
    assert.deepEqual(lines, [shellRecord, readRecord]);
  } finally {
    auditFixture.cleanup();
  }
});

test("ReviewRunToolAudit reports buffered flush failures with the bound audit path", async () => {
  const auditFixture = createAuditFileFixture();
  const failures: Array<{ auditFilePath: string | undefined; message: string }> = [];

  try {
    const toolAudit = new ReviewRunToolAudit({
      onWriteFailure(failure) {
        failures.push({
          auditFilePath: failure.auditFilePath,
          message: failure.error instanceof Error
            ? failure.error.message
            : String(failure.error)
        });
      }
    });

    toolAudit.sink.append(createToolAuditRecord({ tool: "shell" }));
    toolAudit.bindOutputTarget({ toolAuditPath: auditFixture.tempDir });

    await toolAudit.flush();

    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.auditFilePath, auditFixture.tempDir);
    assert.match(failures[0]?.message ?? "", /EISDIR|illegal operation on a directory/u);
  } finally {
    auditFixture.cleanup();
  }
});
