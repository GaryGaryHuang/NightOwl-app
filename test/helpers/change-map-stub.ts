import type { ChangeMap } from "../../src/core/change-map.ts";

/**
 * Build a minimal `ChangeMap` for tests that previously stubbed Step 0 with
 * a Markdown string only. Defaults to empty structured arrays; callers can
 * override per test.
 */
export function stubChangeMap(
  overviewMarkdown: string,
  overrides: Partial<Omit<ChangeMap, "schemaVersion" | "overviewMarkdown">> = {}
): ChangeMap {
  return Object.freeze({
    schemaVersion: 1,
    overviewMarkdown,
    changedFiles: Object.freeze(overrides.changedFiles ?? []),
    fileGroups: Object.freeze(overrides.fileGroups ?? []),
    crossFileBoundaries: Object.freeze(overrides.crossFileBoundaries ?? []),
    testCoverageObservations: Object.freeze(
      overrides.testCoverageObservations ?? []
    ),
    behaviorChanges: Object.freeze(overrides.behaviorChanges ?? []),
    evidenceRefs: Object.freeze(overrides.evidenceRefs ?? []),
    unresolvedUnknowns: Object.freeze(overrides.unresolvedUnknowns ?? [])
  }) as ChangeMap;
}
