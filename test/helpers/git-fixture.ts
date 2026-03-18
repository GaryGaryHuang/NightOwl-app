import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface ReviewRepoFixture {
  repoDir: string;
  appDir: string;
  cleanup(): void;
  git(...args: string[]): string;
  writeFile(relativePath: string, content: string): void;
  removeFile(relativePath: string): void;
  commitAll(message: string): void;
}

export function createReviewRepoFixture(): ReviewRepoFixture {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-review-repo-"));
  const repoDir = path.join(tempDir, "repo");
  const appDir = path.join(repoDir, "packages", "app");

  mkdirSync(repoDir, { recursive: true });
  runGit(repoDir, ["init", "-b", "main"]);
  runGit(repoDir, ["config", "user.name", "NightOwl Test"]);
  runGit(repoDir, ["config", "user.email", "nightowl@example.com"]);

  writeRepoFile(repoDir, "README.md", "# Demo\n");
  writeRepoFile(repoDir, "src/app.ts", "export const value = 1;\n");
  writeRepoFile(repoDir, "packages/app/index.ts", "export const nested = 1;\n");
  writeRepoFile(repoDir, "dist/app.js", "console.log('base');\n");
  writeRepoFile(repoDir, "obsolete.txt", "remove me\n");
  commitAllInRepo(repoDir, "base");

  runGit(repoDir, ["checkout", "-q", "-b", "feature-branch"]);
  writeRepoFile(repoDir, "src/app.ts", "export const value = 2;\n");
  writeRepoFile(
    repoDir,
    "packages/app/index.ts",
    "export const nested = 2;\n"
  );
  writeRepoFile(repoDir, "dist/app.js", "console.log('feature');\n");
  rmSync(path.join(repoDir, "obsolete.txt"), { force: true });
  commitAllInRepo(repoDir, "feature");

  return {
    repoDir,
    appDir,
    cleanup() {
      rmSync(tempDir, { force: true, recursive: true });
    },
    git(...args: string[]) {
      return runGit(repoDir, args);
    },
    writeFile(relativePath: string, content: string) {
      writeRepoFile(repoDir, relativePath, content);
    },
    removeFile(relativePath: string) {
      rmSync(path.join(repoDir, relativePath), { force: true, recursive: true });
    },
    commitAll(message: string) {
      commitAllInRepo(repoDir, message);
    }
  };
}

function commitAllInRepo(repoDir: string, message: string): void {
  runGit(repoDir, ["add", "-A"]);
  runGit(repoDir, ["commit", "-m", message, "--no-gpg-sign"]);
}

function writeRepoFile(
  repoDir: string,
  relativePath: string,
  content: string
): void {
  const absolutePath = path.join(repoDir, relativePath);

  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8"
  }).trim();
}
