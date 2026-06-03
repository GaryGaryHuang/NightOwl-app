/**
 * Per-file head-side diff anchor map.
 *
 * Pure, deterministic derivation from a unified diff string. Only the head-side
 * (`+s,c`) hunk header is parsed because finding traceability targets the
 * post-change file. See `openspec/specs/diff-anchor-map/` for the full contract.
 */

export interface DiffHunkAnchor {
  /** Verbatim hunk header line (trimmed). */
  readonly hunkHeader: string;
  /** 1-based head-side starting line number from the `+s,c` segment. */
  readonly headLineStart: number;
  /** Inclusive head-side ending line. Equals headLineStart for pure deletions (c=0). */
  readonly headLineEnd: number;
  /** Head-side line numbers whose body line begins with `+`. */
  readonly changedHeadLines: ReadonlySet<number>;
}

export interface DiffAnchorMap {
  readonly hunks: readonly DiffHunkAnchor[];
}

const HUNK_HEADER_PATTERN =
  /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;

export function buildDiffAnchorMap(diffContent: string): DiffAnchorMap {
  if (!diffContent) {
    return { hunks: [] };
  }

  const lines = diffContent.split("\n");
  const hunks: DiffHunkAnchor[] = [];

  let activeHeader: string | undefined;
  let activeHeadStart = 0;
  let activeHeadCountDeclared = 0;
  let activeHeadCursor = 0;
  let activeChanged = new Set<number>();

  const flush = (): void => {
    if (activeHeader === undefined) {
      return;
    }

    const headLineEnd =
      activeHeadCountDeclared === 0
        ? activeHeadStart
        : activeHeadStart + activeHeadCountDeclared - 1;

    hunks.push({
      hunkHeader: activeHeader,
      headLineStart: activeHeadStart,
      headLineEnd,
      changedHeadLines: activeChanged
    });

    activeHeader = undefined;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const headerMatch = HUNK_HEADER_PATTERN.exec(trimmed);

    if (headerMatch) {
      flush();

      const headStart = Number.parseInt(headerMatch[1] ?? "0", 10);
      const headCount =
        headerMatch[2] === undefined ? 1 : Number.parseInt(headerMatch[2], 10);

      activeHeader = trimmed;
      activeHeadStart = headStart;
      activeHeadCountDeclared = headCount;
      activeHeadCursor = headStart;
      activeChanged = new Set<number>();
      continue;
    }

    if (activeHeader === undefined) {
      continue;
    }

    if (rawLine.startsWith("\\")) {
      // "\ No newline at end of file" marker — does not advance head cursor.
      continue;
    }

    if (rawLine.startsWith("+")) {
      activeChanged.add(activeHeadCursor);
      activeHeadCursor += 1;
      continue;
    }

    if (rawLine.startsWith("-")) {
      // Deletion — head cursor does not advance.
      continue;
    }

    // Treat context lines (leading space) and any other body line as context.
    activeHeadCursor += 1;
  }

  flush();

  return { hunks };
}
