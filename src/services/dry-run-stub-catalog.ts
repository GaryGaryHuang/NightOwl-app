import {
  CANDIDATE_FINDINGS_STEP_ID,
  CHANGESET_OVERVIEW_STEP_ID,
  REVIEW_BASIS_STEP_ID,
  REVIEW_SUMMARY_STEP_ID,
  SEMANTIC_VALIDATION_STEP_ID
} from "../core/review-step-ids.ts";

const GENERIC_DRY_RUN_STUB =
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

function buildDryRunChangesetOverviewResponse(prompt: string): string {
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
        ]
  });
}

function buildDryRunReviewBasisResponse(prompt: string): string {
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
        confidence: "low"
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
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Dry-run hypothesis for exercising Candidate Findings.",
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

const STUB_CANDIDATE_FINDINGS = '{"findings": [], "findingOrigins": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "dry-run stub has no findings"}], "criticalMissingInformation": []}';

const STUB_SEMANTIC_VALIDATION = '{"perFindingResults": [], "missingInformationItems": [], "loopControl": {"action": "accept", "reason": "dry-run stub has no candidates"}}';

const STUB_SUMMARY = [
  "### Review Basis",
  "- Change summary: dry-run has no actual file changes.",
  "- Verified evidence: dry-run stub.",
  "- Pending information: None.",
  "### Behavior Change Notes",
  "- No behavior changes"
].join("\n");

type DryRunResponseProvider = (prompt: string) => string;

const DRY_RUN_STUB_RESPONSES = {
  [REVIEW_BASIS_STEP_ID]: STUB_REVIEW_BASIS,
  [CANDIDATE_FINDINGS_STEP_ID]: STUB_CANDIDATE_FINDINGS,
  [SEMANTIC_VALIDATION_STEP_ID]: STUB_SEMANTIC_VALIDATION,
  [REVIEW_SUMMARY_STEP_ID]: STUB_SUMMARY
} as const;

type BuiltInDryRunStepId = keyof typeof DRY_RUN_STUB_RESPONSES;

export function getDryRunResponseProvider(
  stepId?: string
): DryRunResponseProvider {
  if (stepId === CHANGESET_OVERVIEW_STEP_ID) {
    return buildDryRunChangesetOverviewResponse;
  }
  if (stepId === REVIEW_BASIS_STEP_ID) {
    return buildDryRunReviewBasisResponse;
  }

  const response =
    stepId && stepId in DRY_RUN_STUB_RESPONSES
      ? DRY_RUN_STUB_RESPONSES[stepId as BuiltInDryRunStepId]
      : GENERIC_DRY_RUN_STUB;

  return () => response;
}
