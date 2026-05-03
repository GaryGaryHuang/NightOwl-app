export const GENERIC_DRY_RUN_STUB =
  "[dry-run] No built-in stub template for this step.";

const STUB_CHANGESET_OVERVIEW_MARKDOWN = [
  "## Changeset Overview",
  "- Scope: Dry-run stub.",
  "- Boundaries: Dry-run stub.",
  "- Behavior changes: Dry-run stub.",
  "- Test coverage: Dry-run stub."
].join("\n");

type DryRunChangeMapStatus = "A" | "M" | "D" | "R";

interface DryRunChangedFileEntry {
  readonly path: string;
  readonly status: DryRunChangeMapStatus;
}

/**
 * Build a deterministic ChangeMap JSON for dry-run Step 0 by parsing the
 * `<changed_files>` block out of the prompt. Uses the head-side path field
 * for rename/copy entries (last tab-separated field).
 */
export function buildDryRunChangesetOverviewResponse(prompt: string): string {
  const changedFileEntries = extractChangedFilesBlockEntries(prompt);
  const changedFiles = changedFileEntries.map((entry) => ({
    path: entry.path,
    status: entry.status,
    category: "feature" as const,
    group: "dry-run" as const,
    basis: "name-status" as const
  }));

  return JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown: STUB_CHANGESET_OVERVIEW_MARKDOWN,
    changedFiles,
    fileGroups: changedFiles.length === 0
      ? []
      : [
          {
            id: "G1",
            label: "dry-run",
            files: changedFiles.map((entry) => entry.path),
            observedChange: "Dry-run stub."
          }
        ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [],
    evidenceRefs: [],
    unresolvedUnknowns: []
  });
}

function extractChangedFilesBlockEntries(prompt: string): DryRunChangedFileEntry[] {
  const startIdx = prompt.indexOf("<changed_files>");
  const endIdx = prompt.indexOf("</changed_files>");
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    return [];
  }
  const block = prompt.slice(startIdx + "<changed_files>".length, endIdx);
  const entries: DryRunChangedFileEntry[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const fields = line.split("\t");
    if (fields.length < 2) continue;
    const status = normalizeDryRunStatus(fields[0]);
    const path = fields[fields.length - 1];
    if (path.length > 0) {
      entries.push({ path, status });
    }
  }
  return entries;
}

function normalizeDryRunStatus(statusField: string): DryRunChangeMapStatus {
  if (/^R\d*$/u.test(statusField)) {
    return "R";
  }
  if (/^C\d*$/u.test(statusField)) {
    return "A";
  }

  switch (statusField) {
    case "A":
    case "M":
    case "D":
    case "R":
      return statusField;
    default:
      return "M";
  }
}

const STUB_OVERVIEW = "## Overview";

const STUB_DEPENDENCIES_BOUNDARIES = "## Dependencies & Boundaries";

const STUB_KNOWLEDGE_SOURCE_OF_TRUTH = "## Knowledge & Source of Truth";

const STUB_STRATEGY_WHAT_IF = "## Strategy & What-if Scenarios";

const STUB_VALIDATION_INTERROGATION = '{"schemaVersion": 2, "findings": []}';

const STUB_COGNITIVE_SIMULATION = '{"schemaVersion": 2, "findingUpdates": [], "dispositions": []}';

const STUB_SUMMARY = [
  "## Summary",
  "- Overall risk level: None"
].join("\n");

export type DryRunResponseProvider = (prompt: string) => string;

const DRY_RUN_STUB_RESPONSES = {
  "step1-overview": STUB_OVERVIEW,
  "step2-dependencies-boundaries": STUB_DEPENDENCIES_BOUNDARIES,
  "step3-knowledge-source-of-truth": STUB_KNOWLEDGE_SOURCE_OF_TRUTH,
  "step4-strategy-what-if-scenarios": STUB_STRATEGY_WHAT_IF,
  "step5-validation-interrogation": STUB_VALIDATION_INTERROGATION,
  "step6-cognitive-simulation": STUB_COGNITIVE_SIMULATION,
  "step7-summary": STUB_SUMMARY
} as const;

type BuiltInDryRunStepId = keyof typeof DRY_RUN_STUB_RESPONSES;

export const BUILT_IN_DRY_RUN_STEP_IDS = Object.keys(
  DRY_RUN_STUB_RESPONSES
) as BuiltInDryRunStepId[];

export function getDryRunStubResponse(
  stepId: BuiltInDryRunStepId
): string | undefined {
  return DRY_RUN_STUB_RESPONSES[stepId];
}

export function getDryRunResponseProvider(
  stepId?: string
): DryRunResponseProvider {
  if (stepId === "changeset-overview") {
    return buildDryRunChangesetOverviewResponse;
  }

  const response =
    stepId && stepId in DRY_RUN_STUB_RESPONSES
      ? DRY_RUN_STUB_RESPONSES[stepId as BuiltInDryRunStepId]
      : GENERIC_DRY_RUN_STUB;

  return () => response;
}
