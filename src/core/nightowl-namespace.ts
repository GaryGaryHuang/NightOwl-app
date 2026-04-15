import path from "node:path";

/** Canonical NightOwl namespace directory name under repo root. */
export const NIGHTOWL_DIR = ".nightowl";

/** Absolute path to the NightOwl namespace root: `<repoRoot>/.nightowl` */
export function nightowlRoot(repoRoot: string): string {
  return path.join(repoRoot, NIGHTOWL_DIR);
}

/** Absolute path to the review config: `<repoRoot>/.nightowl/reviewconfig.json` */
export function reviewConfigPath(repoRoot: string): string {
  return path.join(repoRoot, NIGHTOWL_DIR, "reviewconfig.json");
}

/** Absolute path to the review ignore rules: `<repoRoot>/.nightowl/reviewignore` */
export function reviewIgnorePath(repoRoot: string): string {
  return path.join(repoRoot, NIGHTOWL_DIR, "reviewignore");
}

/** Absolute path to the review output root: `<repoRoot>/.nightowl/review` */
export function reviewOutputRoot(repoRoot: string): string {
  return path.join(repoRoot, NIGHTOWL_DIR, "review");
}
