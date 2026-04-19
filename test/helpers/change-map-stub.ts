import type { ChangeMap } from "../../src/core/change-map.ts";

/**
 * Build a minimal `ChangeMap` for tests that previously stubbed Step 0 with
 * a Markdown string only. Defaults to empty `changedFiles` / `behaviorChanges`
 * / `unresolvedUnknowns`; callers can override per test.
 */
export function stubChangeMap(
  overviewMarkdown: string,
  overrides: Partial<Omit<ChangeMap, "schemaVersion" | "overviewMarkdown">> = {}
): ChangeMap {
  return Object.freeze({
    schemaVersion: 1,
    overviewMarkdown,
    changedFiles: Object.freeze(overrides.changedFiles ?? []),
    behaviorChanges: Object.freeze(overrides.behaviorChanges ?? []),
    unresolvedUnknowns: Object.freeze(overrides.unresolvedUnknowns ?? [])
  }) as ChangeMap;
}
