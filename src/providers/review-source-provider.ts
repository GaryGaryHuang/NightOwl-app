export interface ReviewSourceProvider {
  resolveRepoRoot(startPath: string): string;
  getChangedFiles(repoRoot: string, baseRef: string, headRef: string): string[];
  getChangesetEntries(repoRoot: string, baseRef: string, headRef: string): string[];
  getDiff(
    repoRoot: string,
    baseRef: string,
    headRef: string,
    filePath: string
  ): string;
  getCurrentBranch(repoRoot: string): string | undefined;
  filterIgnoredFiles(repoRoot: string, files: string[]): string[];
}
