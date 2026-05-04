export const DEFAULT_HUNK_HEADER = "@@ -20,2 +20,4 @@";
export const DEFAULT_DIFF = [
  DEFAULT_HUNK_HEADER,
  " context-before",
  "+added-21",
  "+added-22",
  " context-after"
].join("\n");

export function lineRangeTraceability(lineStart: unknown, lineEnd: unknown) {
  return {
    kind: "line-range",
    lineStart,
    lineEnd
  };
}

export function diffHunkTraceability(hunkHeader: unknown) {
  return {
    kind: "diff-hunk",
    hunkHeader
  };
}
