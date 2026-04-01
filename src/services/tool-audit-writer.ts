import { appendFileSync } from "node:fs";

export interface ToolAuditRecord {
  ts: string;                 // ISO 8601 UTC
  tool: string;               // Observed tool name/kind, e.g. "bash", "shell", "web_fetch", "url", "read", "write", ...
  decision: "allow" | "deny";
  reason?: string;            // present when deny; also used as diagnostic note for deferred-allow
  args: Record<string, string | undefined>;
}

/**
 * Append tool-decision audit records to the JSONL log on a best-effort basis.
 */
export class ToolAuditWriter {
  readonly #auditFilePath: string;

  constructor(auditFilePath: string) {
    this.#auditFilePath = auditFilePath;
  }

  append(record: ToolAuditRecord): void {
    try {
      appendFileSync(this.#auditFilePath, JSON.stringify(record) + "\n");
    } catch {
      // best-effort: silently ignore write failures
    }
  }
}
