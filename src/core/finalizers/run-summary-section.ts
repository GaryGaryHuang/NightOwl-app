import path from "node:path";

import type { PlannedNoteFile } from "../review-path-resolver.ts";
import type { ResolvedFileOutcome } from "../run-outcome-resolver.ts";
import { countMustFindings, countNiceFindings } from "../risk-level.ts";

interface ReviewedFilesSectionRenderInput {
  basePath: string;
  plannedNotes: PlannedNoteFile[];
  resolvedOutcomes: ResolvedFileOutcome[];
}

interface SuccessfulEntryStats {
  mustCount: number;
  niceCount: number;
  missingInformationCount: number;
}

interface IndexedResolvedOutcome {
  plannedIndex: number;
  note: PlannedNoteFile;
  resolved: ResolvedFileOutcome;
}

/**
 * Render the attention-file section embedded in index.md.
 */
export function renderFilesRequiringAttentionSection(
  input: ReviewedFilesSectionRenderInput
): string | undefined {
  const attentionEntries = indexedSuccessfulOutcomes(input)
    .map((entry) => ({
      ...entry,
      stats: buildSuccessfulEntryStats(entry.resolved.outcome)
    }))
    .filter((entry) => isAttentionEntry(entry.stats))
    .sort((a, b) => compareAttentionEntries(a, b));

  if (attentionEntries.length === 0) {
    return undefined;
  }

  return [
    "## Files Requiring Attention",
    "| File | Must | Nice | Missing Info |",
    "| --- | ---: | ---: | ---: |",
    ...attentionEntries.map(
      (entry) =>
        `| ${formatAttentionTableLink(input.basePath, entry.note)} | ${entry.stats.mustCount} | ${entry.stats.niceCount} | ${entry.stats.missingInformationCount} |`
    )
  ].join("\n");
}

/**
 * Render the skipped-file section embedded in index.md.
 */
export function renderSkippedFilesSection(
  input: ReviewedFilesSectionRenderInput
): string | undefined {
  const skippedEntries = indexedResolvedOutcomes(input).filter(
    (entry): entry is IndexedResolvedOutcome & {
      resolved: Extract<ResolvedFileOutcome, { status: "skipped" }>;
    } => entry.resolved.status === "skipped"
  );

  if (skippedEntries.length === 0) {
    return undefined;
  }

  return [
    "## Skipped Files",
    ...skippedEntries.map((entry) => `- ${formatNoteLink(input.basePath, entry.note)}`)
  ].join("\n");
}

/**
 * Render the clean-file section embedded in index.md.
 */
export function renderCleanFilesSection(
  input: ReviewedFilesSectionRenderInput
): string | undefined {
  const cleanEntries = indexedSuccessfulOutcomes(input)
    .map((entry) => ({
      ...entry,
      stats: buildSuccessfulEntryStats(entry.resolved.outcome)
    }))
    .filter((entry) => !isAttentionEntry(entry.stats));

  if (cleanEntries.length === 0) {
    return undefined;
  }

  return [
    "## Clean Files",
    ...cleanEntries.map((entry) => `- ${formatNoteLink(input.basePath, entry.note)}`)
  ].join("\n");
}

function indexedResolvedOutcomes(
  input: ReviewedFilesSectionRenderInput
): IndexedResolvedOutcome[] {
  return input.plannedNotes.map((note, plannedIndex) => ({
    plannedIndex,
    note,
    resolved: input.resolvedOutcomes[plannedIndex]
  }));
}

function indexedSuccessfulOutcomes(input: ReviewedFilesSectionRenderInput): Array<
  IndexedResolvedOutcome & {
    resolved: Extract<ResolvedFileOutcome, { status: "successful" }>;
  }
> {
  return indexedResolvedOutcomes(input).filter(
    (entry): entry is IndexedResolvedOutcome & {
      resolved: Extract<ResolvedFileOutcome, { status: "successful" }>;
    } => entry.resolved.status === "successful"
  );
}

function buildSuccessfulEntryStats(
  outcome: Extract<ResolvedFileOutcome, { status: "successful" }>['outcome']
): SuccessfulEntryStats {
  return {
    mustCount: countMustFindings(outcome.findings),
    niceCount: countNiceFindings(outcome.findings),
    missingInformationCount: outcome.semanticReview.missingInformationCount
  };
}

function isAttentionEntry(stats: SuccessfulEntryStats): boolean {
  return (
    stats.mustCount > 0 ||
    stats.niceCount > 0 ||
    stats.missingInformationCount > 0
  );
}

function compareAttentionEntries(
  a: IndexedResolvedOutcome & { stats: SuccessfulEntryStats },
  b: IndexedResolvedOutcome & { stats: SuccessfulEntryStats }
): number {
  const categoryDelta = attentionCategoryRank(a.stats) - attentionCategoryRank(b.stats);
  if (categoryDelta !== 0) {
    return categoryDelta;
  }

  if (a.stats.mustCount !== b.stats.mustCount) {
    return b.stats.mustCount - a.stats.mustCount;
  }

  if (a.stats.missingInformationCount !== b.stats.missingInformationCount) {
    return b.stats.missingInformationCount - a.stats.missingInformationCount;
  }

  if (a.stats.niceCount !== b.stats.niceCount) {
    return b.stats.niceCount - a.stats.niceCount;
  }

  return a.plannedIndex - b.plannedIndex;
}

function attentionCategoryRank(stats: SuccessfulEntryStats): number {
  if (stats.mustCount > 0) {
    return 0;
  }

  if (stats.missingInformationCount > 0) {
    return 1;
  }

  return 2;
}

function formatNoteLink(basePath: string, note: PlannedNoteFile): string {
  const link = toRelativeLink(basePath, note.noteFilePath);
  return `[\`${note.filePath}\`](${link})`;
}

function formatAttentionTableLink(basePath: string, note: PlannedNoteFile): string {
  const link = toRelativeLink(basePath, note.noteFilePath);
  return `[${escapeMarkdownTableLinkLabel(note.filePath)}](${link})`;
}

function escapeMarkdownTableLinkLabel(label: string): string {
  return label
    .replace(/\\/gu, "\\\\")
    .replace(/\|/gu, "\\|")
    .replace(/\[/gu, "\\[")
    .replace(/\]/gu, "\\]");
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
