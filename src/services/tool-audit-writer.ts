import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

export interface ToolAuditOutputTarget {
  toolAuditPath: string;
}

export interface ToolAuditWriteFailure {
  auditFilePath: string | undefined;
  error: unknown;
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
 *   `attachAuditFile(path)` is called, which queues the buffer for async flush and switches to direct-write.
 *
 * All disk writes are internally chained to preserve append order.
 * Use `flush()` to await completion of all pending writes.
 */
export class ToolAuditWriter implements ToolAuditSink {
  #auditFilePath: string | undefined;
  #buffer: ToolAuditRecord[] | undefined;
  #writeChain: Promise<void> = Promise.resolve();
  #writeFailureLogged = false;
  readonly #onWriteFailure?: (failure: ToolAuditWriteFailure) => void;

  constructor(
    auditFilePath?: string,
    options?: { onWriteFailure?: (failure: ToolAuditWriteFailure) => void }
  ) {
    if (auditFilePath !== undefined) {
      this.#auditFilePath = auditFilePath;
    } else {
      this.#buffer = [];
    }
    this.#onWriteFailure = options?.onWriteFailure;
  }

  append(record: ToolAuditRecord): void {
    if (this.#buffer !== undefined) {
      this.#buffer.push(record);
      return;
    }
    this.#enqueueWrite(record);
  }

  get bufferedRecordCount(): number {
    return this.#buffer?.length ?? 0;
  }

  attachAuditFile(auditFilePath: string): void {
    if (this.#auditFilePath !== undefined) {
      throw new AuditWriterStateError("tool audit file can only be attached once");
    }
    this.#auditFilePath = auditFilePath;
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
      } catch (error) {
        // Best-effort: report the first write failure via the callback so callers
        // have a chance to log a diagnostic, then silently ignore subsequent failures
        // to avoid flooding output during a review session.
        if (!this.#writeFailureLogged) {
          this.#writeFailureLogged = true;
          this.#onWriteFailure?.({
            auditFilePath: this.#auditFilePath,
            error
          });
        }
      }
    });
  }
}

/**
 * Run-scoped tool-audit lifecycle for review sessions that may emit audit
 * records before the review output target has been initialized.
 */
export class ReviewRunToolAudit {
  readonly #writer: ToolAuditWriter;
  readonly #onWriteFailure?: (failure: ToolAuditWriteFailure) => void;

  constructor(
    options?: { onWriteFailure?: (failure: ToolAuditWriteFailure) => void }
  ) {
    this.#writer = new ToolAuditWriter(undefined, options);
    this.#onWriteFailure = options?.onWriteFailure;
  }

  get sink(): ToolAuditSink {
    return this.#writer;
  }

  bindOutputTarget(outputTarget: ToolAuditOutputTarget): void {
    this.#writer.attachAuditFile(outputTarget.toolAuditPath);
  }

  async bindFailureOutputTarget(outputTarget: ToolAuditOutputTarget): Promise<void> {
    if (this.#writer.bufferedRecordCount === 0) {
      return;
    }

    try {
      await mkdir(path.dirname(outputTarget.toolAuditPath), { recursive: true });
      await writeFile(outputTarget.toolAuditPath, "");
      this.bindOutputTarget(outputTarget);
    } catch (error) {
      this.#onWriteFailure?.({
        auditFilePath: outputTarget.toolAuditPath,
        error
      });
    }
  }

  flush(): Promise<void> {
    return this.#writer.flush();
  }
}
