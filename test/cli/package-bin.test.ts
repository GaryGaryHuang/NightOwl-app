import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FOUNDATION_PLACEHOLDER_MESSAGE
} from "../../src/app/review-app.ts";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..", "..");

test("package exposes an installable review executable", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  );

  assert.equal(packageJson.bin.review, "./dist/bin/review.js");

  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-bin-test-"));
  const appCopyDir = path.join(tempDir, "app");
  const cacheDir = path.join(tempDir, "cache");
  const prefixDir = path.join(tempDir, "prefix");

  cpSync(repoRoot, appCopyDir, { recursive: true });
  rmSync(path.join(appCopyDir, "dist"), { force: true, recursive: true });

  const installResult = spawnSync(
    "npm",
    [
      "install",
      "-g",
      ".",
      "--prefix",
      prefixDir,
      "--cache",
      cacheDir
    ],
    {
      cwd: appCopyDir,
      encoding: "utf8"
    }
  );

  assert.equal(
    installResult.status,
    0,
    installResult.stderr || installResult.stdout
  );

  const binaryPath = path.join(prefixDir, "bin", "review");

  assert.ok(existsSync(binaryPath), "installed review executable should exist");

  const execResult = spawnSync(binaryPath, ["main", "feature-branch"], {
    encoding: "utf8"
  });

  assert.equal(execResult.status, 0, execResult.stderr || execResult.stdout);
  assert.match(execResult.stdout, new RegExp(FOUNDATION_PLACEHOLDER_MESSAGE));
});
