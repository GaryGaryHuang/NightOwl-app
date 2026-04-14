import { appendFileSync } from "node:fs";

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

/**
 * Append tool-decision audit records to the JSONL log on a best-effort basis.
 *
 * Supports two construction modes:
 * - **Direct-write** (`new ToolAuditWriter(path)`): records are appended to disk immediately.
 * - **Buffering** (`new ToolAuditWriter()`): records are held in memory until
 *   `setPath(path)` is called, which flushes the buffer and switches to direct-write.
 */
export class ToolAuditWriter implements ToolAuditSink {
  #auditFilePath: string | undefined;
  #buffer: ToolAuditRecord[] | undefined;

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
    try {
      appendFileSync(this.#auditFilePath!, JSON.stringify(record) + "\n");
    } catch {
      // best-effort: silently ignore write failures
    }
  }

  setPath(path: string): void {
    if (this.#auditFilePath !== undefined) {
      throw new Error("setPath() can only be called once");
    }
    this.#auditFilePath = path;
    const buffered = this.#buffer!;
    this.#buffer = undefined;
    for (const record of buffered) {
      try {
        appendFileSync(this.#auditFilePath, JSON.stringify(record) + "\n");
      } catch {
        // best-effort: skip failed records during flush
      }
    }
  }
}
