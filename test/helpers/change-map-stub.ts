import type { ChangeMapReadinessV2 } from "../../src/core/change-map.ts";

/**
 * Build a minimal `ChangeMapReadinessV2` for tests that stub Step 0 with
 * a Markdown string only. Defaults to empty structured arrays; callers can
 * override per test.
 */
export function stubChangeMap(
  overviewMarkdown: string,
  overrides: Partial<Omit<ChangeMapReadinessV2, "schemaVersion" | "overviewMarkdown">> = {}
): ChangeMapReadinessV2 {
  return Object.freeze({
    schemaVersion: 2,
    reviewObjective: Object.freeze(
      overrides.reviewObjective ?? {
        summary: "Test review context.",
        requestedFocus: Object.freeze([]),
        expectedBehaviorSummary: Object.freeze([])
      }
    ),
    userContextSSOT: Object.freeze(overrides.userContextSSOT ?? []),
    expectedBehaviorLedger: Object.freeze(
      overrides.expectedBehaviorLedger ?? []
    ),
    missingInformation: Object.freeze(overrides.missingInformation ?? []),
    overviewMarkdown,
    behaviorChanges: Object.freeze(overrides.behaviorChanges ?? []),
    unresolvedUnknowns: Object.freeze(overrides.unresolvedUnknowns ?? [])
  }) as ChangeMapReadinessV2;
}
