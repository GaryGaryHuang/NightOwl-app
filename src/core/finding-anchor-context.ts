import { buildDiffAnchorMap, type DiffAnchorMap } from "./diff-anchor-map.ts";

export interface FindingAnchorValidationContext {
  readonly filePath: string;
  readonly diffAnchorMap: DiffAnchorMap;
}

export function buildFindingAnchorValidationContext(
  filePath: string,
  diffContent: string
): FindingAnchorValidationContext {
  return {
    filePath,
    diffAnchorMap: buildDiffAnchorMap(filePath, diffContent)
  };
}
