import { appendFile } from "node:fs/promises";

export interface ToolAuditRecord {
  ts: string;                 // ISO 8601 UTC
  tool: string;               // Observed tool name/kind, e.g. "bash", "shell", "web_fetch", "url", "read", "write", ...
  decision: "allow" | "deny";
  reason?: string;            // present when deny; also used as diagnostic note for deferred-allow
  args: Record<string, string | undefined>;
}

export interface ToolAuditSink {
  append(record: ToolAuditRecord): void;
}

export class AuditWriterStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditWriterStateError";
  }
}

/**
 * Append tool-decision audit records to the JSONL log on a best-effort basis.
 *
 * Supports two construction modes:
 * - **Direct-write** (`new ToolAuditWriter(path)`): records are appended to disk asynchronously.
 * - **Buffering** (`new ToolAuditWriter()`): records are held in memory until
 *   `setPath(path)` is called, which queues the buffer for async flush and switches to direct-write.
 *
 * All disk writes are internally chained to preserve append order.
 * Use `flush()` to await completion of all pending writes.
 */
export class ToolAuditWriter implements ToolAuditSink {
  #auditFilePath: string | undefined;
  #buffer: ToolAuditRecord[] | undefined;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(auditFilePath?: string) {
    if (auditFilePath !== undefined) {
      this.#auditFilePath = auditFilePath;
    } else {
      this.#buffer = [];
    }
  }

  append(record: ToolAuditRecord): void {
    if (this.#buffer !== undefined) {
      this.#buffer.push(record);
      return;
    }
    this.#enqueueWrite(record);
  }

  setPath(path: string): void {
    if (this.#auditFilePath !== undefined) {
      throw new AuditWriterStateError("setPath() can only be called once");
    }
    this.#auditFilePath = path;
    const buffered = this.#buffer!;
    this.#buffer = undefined;
    for (const record of buffered) {
      this.#enqueueWrite(record);
    }
  }

  flush(): Promise<void> {
    return this.#writeChain;
  }

  #enqueueWrite(record: ToolAuditRecord): void {
    this.#writeChain = this.#writeChain.then(async () => {
      try {
        await appendFile(this.#auditFilePath!, JSON.stringify(record) + "\n");
      } catch {
        // best-effort: silently ignore write failures
      }
    });
  }
}
