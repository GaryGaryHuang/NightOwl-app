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
  const userContextEntries = extractUserContextEntries(prompt);
  const changedFiles = changedFileEntries.map((entry) => ({
    path: entry.path,
    status: entry.status,
    category: "feature" as const,
    group: "dry-run" as const,
    basis: "name-status" as const
  }));
  const deletedPathCount = changedFiles.filter((entry) => entry.status === "D").length;

  return JSON.stringify({
    schemaVersion: 2,
    readiness: "READY_WITH_LIMITATIONS",
    reviewObjective: {
      summary: "Dry-run review context.",
      requestedFocus: [],
      expectedBehaviorSummary: []
    },
    userContextSSOT: userContextEntries.map((entry, index) => ({
      contextId: `UC${index + 1}`,
      rawText: entry,
      categories: ["other"],
      extractedFacts: []
    })),
    changeScope: {
      totalChangedPaths: changedFiles.length,
      reviewableNonDeletedPaths: changedFiles.length - deletedPathCount,
      deletedPaths: deletedPathCount,
      binaryOrNonReviewablePaths: 0,
      changedTests: [],
      highRiskAreas: []
    },
    coveragePlan: {
      mustDistinguishDeletedAndBinaryPaths: true,
      notes: ["Dry-run review treats every non-deleted changed path as reviewable."]
    },
    expectedBehaviorLedger: [],
    missingInformation: [],
    proceedRationale: "Dry-run response is deterministic and suitable for exercising the review pipeline.",
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

export function buildDryRunReviewBasisResponse(prompt: string): string {
  const filePath = extractDiffPath(prompt) ?? "dry-run.ts";
  return JSON.stringify({
    schemaVersion: 1,
    filePath,
    roleInChangeset: "Dry-run file basis.",
    changedBehavior: [
      {
        changeId: "CB1",
        before: "Before dry-run review.",
        after: "After dry-run review.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        factId: "FCT1",
        statement: "Dry-run ReviewBasis was generated for this file.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        inferenceId: "INF1",
        statement: "Dry-run can continue to validation with a structured basis.",
        basedOnEvidenceIds: ["E1"],
        confidence: "medium"
      }
    ],
    dependencyMap: {
      upstreamCallers: [],
      downstreamConsumers: [],
      externalContracts: [],
      sharedStateOrSideEffects: []
    },
    flowMap: {
      entryPoints: [],
      stateTransitions: [],
      asyncBoundaries: [],
      errorPaths: []
    },
    testCoverage: {
      changedTests: [],
      observedCoverageSignals: [],
      coverageGaps: []
    },
    identifierRegistry: {
      files: [filePath],
      symbols: [],
      resourceKeys: [],
      apiNames: [],
      stateNames: []
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Dry-run hypothesis for exercising Step 5.",
        triggerCondition: "Dry-run pipeline reaches validation.",
        whyRelevantHere: "Phase 1 requires a structured ReviewBasis before Step 5.",
        closureCriteria: ["Step 5 can consume this hypothesis without Step 4 prose."]
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: filePath,
        summary: "Dry-run diff evidence."
      }
    ]
  });
}

function extractChangedFilesBlockEntries(prompt: string): DryRunChangedFileEntry[] {
  const jsonEntries = extractChangedFilesJsonEntries(prompt);
  if (jsonEntries) {
    return jsonEntries;
  }

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

function extractChangedFilesJsonEntries(
  prompt: string
): DryRunChangedFileEntry[] | undefined {
  const match = prompt.match(
    /<changed_files_json format="json">\n([\s\S]*?)\n<\/changed_files_json>/u
  );
  if (!match) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1]) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) {
      return [];
    }

    return parsed.entries.flatMap((entry): DryRunChangedFileEntry[] => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as { path?: unknown; status?: unknown };
      if (typeof record.path !== "string" || record.path.length === 0) {
        return [];
      }
      const status =
        typeof record.status === "string"
          ? normalizeDryRunStatus(record.status)
          : "M";
      return [{ path: record.path, status }];
    });
  } catch {
    return [];
  }
}

function extractUserContextEntries(prompt: string): string[] {
  const match = prompt.match(
    /<user_context format="json">\n([\s\S]*?)\n<\/user_context>/u
  );
  if (!match) {
    return [];
  }
  try {
    const parsed = JSON.parse(match[1]) as { entries?: unknown };
    return Array.isArray(parsed.entries)
      ? parsed.entries.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function extractDiffPath(prompt: string): string | undefined {
  const match = prompt.match(/<diff path="([^"]+)"/u);
  return match?.[1];
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

const STUB_REVIEW_BASIS = buildDryRunReviewBasisResponse(
  '<diff path="dry-run.ts" base="main" head="HEAD">\n</diff>'
);

const STUB_VALIDATION_INTERROGATION = '{"schemaVersion": 3, "result": "NO_FINDINGS", "findings": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "evidenceIds": ["E1"], "rationale": "dry-run stub has no findings"}], "criticalMissingInformation": []}';

const STUB_COGNITIVE_SIMULATION = '{"schemaVersion": 1, "overallStatus": "PASS", "perFindingResults": [], "approvedFindings": [], "missingInformationItems": [], "loopControl": {"action": "accept", "reason": "dry-run stub has no candidates"}}';

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
  "review-basis": STUB_REVIEW_BASIS,
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
  if (stepId === "review-basis") {
    return buildDryRunReviewBasisResponse;
  }

  const response =
    stepId && stepId in DRY_RUN_STUB_RESPONSES
      ? DRY_RUN_STUB_RESPONSES[stepId as BuiltInDryRunStepId]
      : GENERIC_DRY_RUN_STUB;

  return () => response;
}
