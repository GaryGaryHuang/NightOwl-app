import path from "node:path";

import type {
  OutputTarget,
  PlannedNoteFile
} from "../review-path-resolver.ts";
import { deriveFileRiskLevel, RISK_ORDER } from "../risk-level.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";

// Derives from RISK_ORDER key count so skipped items always sort after every known risk level.
const SKIPPED_SORT_KEY = Object.keys(RISK_ORDER).length;

export interface ReviewIndexRenderInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  outputTarget: OutputTarget;
  plannedNotes: PlannedNoteFile[];
  resolvedOutcomes: ResolvedFileOutcome[];
}

/**
 * Render the run index with deterministic artifact links and severity-ordered file notes.
 */
export function renderReviewIndex(input: ReviewIndexRenderInput): string {
    const resolvedOutcomes = input.resolvedOutcomes;

    const successfulCount = resolvedOutcomes.filter((r) => r.status === "successful").length;
    const skippedCount = resolvedOutcomes.filter((r) => r.status === "skipped").length;

    const indexedOutcomes = input.plannedNotes.map((note, index) => ({
      note,
      resolved: resolvedOutcomes[index]
    }));

    const sortedEntries = [...indexedOutcomes].sort((a, b) => {
      const aKey = a.resolved.status === "successful"
        ? RISK_ORDER[deriveFileRiskLevel(a.resolved.outcome.findings)]
        : SKIPPED_SORT_KEY;
      const bKey = b.resolved.status === "successful"
        ? RISK_ORDER[deriveFileRiskLevel(b.resolved.outcome.findings)]
        : SKIPPED_SORT_KEY;
      return aKey - bKey;
    });

    const fileNoteLines =
      sortedEntries.length === 0
        ? ["- 無"]
        : sortedEntries.map(({ note, resolved }) => {
            const link = toRelativeLink(
              input.outputTarget.basePath,
              note.noteFilePath
            );

            if (resolved.status === "successful") {
              const prefix = [
                `[${deriveFileRiskLevel(resolved.outcome.findings)}]`,
                formatSemanticBadge(resolved.outcome.semanticReview)
              ].filter(Boolean).join("");
              return [
                `- ${prefix} [\`${note.filePath}\`](${link})`,
                ...formatMissingInformationDetails(resolved.outcome.semanticReview)
              ].join("\n");
            }

            return `- [Skipped] [\`${note.filePath}\`](${link})`;
          });

    return [
      "# Review Index",
      "",
      `- Repo root: \`${input.repoRoot}\``,
      `- Base ref: \`${input.baseRef}\``,
      `- Head ref: \`${input.headRef}\``,
      `- Planned files: ${input.plannedNotes.length}`,
      `- Successful files: ${successfulCount}`,
      `- Skipped files: ${skippedCount}`,
      "",
      "## Run Artifacts",
      `- [changeset-overview.md](${toRelativeLink(input.outputTarget.basePath, input.outputTarget.changesetOverviewPath)})`,
      `- [summary.md](${toRelativeLink(input.outputTarget.basePath, input.outputTarget.summaryPath)})`,
      `- [skipped.md](${toRelativeLink(input.outputTarget.basePath, input.outputTarget.skippedPath)})`,
      "",
      "## File Notes",
      ...fileNoteLines
    ].join("\n");
}

function formatMissingInformationDetails(input: {
  missingInformationCount: number;
} | undefined): string[] {
  if (!input || input.missingInformationCount === 0) {
    return [];
  }

  const itemLabel = input.missingInformationCount === 1 ? "item" : "items";
  return [
    `  - Missing information: ${input.missingInformationCount} ${itemLabel}; open the file note and read \`## Missing Information\`.`
  ];
}

export type ReviewIndexRenderer = typeof renderReviewIndex;

function formatSemanticBadge(input: {
  status: string;
  missingInformationCount: number;
} | undefined): string {
  if (!input) {
    return "";
  }

  const badges: string[] = [];
  if (input.status === "passed") {
    badges.push("[Passed]");
  } else if (input.status === "passed_with_limitations") {
    badges.push("[Limited]");
  }

  if (input.missingInformationCount > 0) {
    badges.push("[MissingInfo]");
  }

  return badges.join("");
}

function toRelativeLink(basePath: string, targetPath: string): string {
  const normalizedBasePath = normalizeForLink(basePath);
  const normalizedTargetPath = normalizeForLink(targetPath);
  const relativePath = path.posix.relative(normalizedBasePath, normalizedTargetPath);
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodePathSegment(segment))
    .join("/");

  return `./${encodedPath}`;
}

function normalizeForLink(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
