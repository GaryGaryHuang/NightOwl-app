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
  const changedPaths = changedFileEntries.map((entry) => entry.path);

  return JSON.stringify({
    reviewObjective: {
      summary: "Dry-run review context.",
      requestedFocus: [],
      expectedBehaviorSummary: []
    },
    userBehavior: [],
    missingInformation: [],
    overviewMarkdown: STUB_CHANGESET_OVERVIEW_MARKDOWN,
    behaviorChanges: changedPaths.length === 0
      ? []
      : [
          {
            description: "Dry-run stub.",
            files: changedPaths
          }
        ],
    unresolvedUnknowns: []
  });
}

export function buildDryRunReviewBasisResponse(prompt: string): string {
  const filePath = extractDiffPath(prompt) ?? "dry-run.ts";
  return JSON.stringify({
    roleInChangeset: "Dry-run file basis.",
    changedBehavior: [
      {
        before: "Before dry-run review.",
        after: "After dry-run review.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: "Dry-run ReviewBasis was generated for this file.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
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
        triggerCondition: "Dry-run pipeline reaches validation."
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

const STUB_REVIEW_BASIS = buildDryRunReviewBasisResponse(
  '<diff path="dry-run.ts" base="main" head="HEAD">\n</diff>'
);

const STUB_VALIDATION_INTERROGATION = '{"findings": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "dry-run stub has no findings"}], "criticalMissingInformation": []}';

const STUB_COGNITIVE_SIMULATION = '{"perFindingResults": [], "missingInformationItems": [], "loopControl": {"action": "accept", "reason": "dry-run stub has no candidates"}}';

const STUB_SUMMARY = [
  "## Summary",
  "### 審查基礎",
  "- 改動概要：dry-run 沒有實際檔案變更。",
  "- 依據規範：dry-run stub。",
  "- 必要假設：無。",
  "### 行為變更提醒",
  "- 無行為變更",
  "### 風險評估",
  "- 整體風險等級：None",
  "- 風險理由：dry-run stub 沒有 approved findings。"
].join("\n");

export type DryRunResponseProvider = (prompt: string) => string;

const DRY_RUN_STUB_RESPONSES = {
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
  stepId: string
): string | undefined {
  return stepId in DRY_RUN_STUB_RESPONSES
    ? DRY_RUN_STUB_RESPONSES[stepId as BuiltInDryRunStepId]
    : undefined;
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
