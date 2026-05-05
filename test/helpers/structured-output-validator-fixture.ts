export const DEFAULT_DIFF = [
  "@@ -20,2 +20,4 @@",
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
