import { appendFileSync } from "node:fs";

export interface ToolAuditRecord {
  ts: string;                 // ISO 8601 UTC
  tool: string;               // "bash" | "web_fetch" | "read" | "write"
  decision: "allow" | "deny";
  reason?: string;            // present only when deny
  args: {
    command?: string;         // bash
    url?: string;             // web_fetch
    path?: string;            // read / write
  };
}

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
