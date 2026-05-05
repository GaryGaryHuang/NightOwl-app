import { buildDiffAnchorMap, type DiffAnchorMap } from "./diff-anchor-map.ts";

export interface FindingAnchorPromptContext {
  readonly filePath: string;
  readonly diffAnchorMap: DiffAnchorMap;
}

export function buildFindingAnchorPromptContext(
  filePath: string,
  diffContent: string
): FindingAnchorPromptContext {
  return {
    filePath,
    diffAnchorMap: buildDiffAnchorMap(filePath, diffContent)
  };
}
