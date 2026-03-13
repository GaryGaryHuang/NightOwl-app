export interface RunRequest {
  baseRef: string;
  headRef: string;
  repoPath?: string;
  userContext: string[];
}
