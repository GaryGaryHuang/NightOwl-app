import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..", "..");
const EXTERNAL_COMMAND_TIMEOUT_MS = 300_000;
const shouldRunPackageBin = process.env.NIGHTOWL_RUN_PACKAGE_BIN === "1";

interface PackageBinWorkspace {
  appCopyDir: string;
  cacheDir: string;
  prefixDir: string;
  tempDir: string;
}

// Validates the full npm pack → global install path, not just running from
// source. This catches issues that only surface in a published package: wrong
// bin entry, missing build output, incorrect file inclusions in the tarball.
//
// Skipped by default because `npm pack` + global install is slow and depends
// on the public npm registry; opt in by setting `NIGHTOWL_RUN_PACKAGE_BIN=1`
// before release. Mirrors the env-gate pattern of run-cli-check-smoke.test.ts.
test("package exposes an installable review executable", { skip: !shouldRunPackageBin }, () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  );

  assert.equal(packageJson.bin.review, "./dist/bin/review.js");

  const workspace = createPackageBinWorkspace();
  try {
    preparePackageCopy(workspace);
    const tarballPath = packPackage(workspace);
    installPackage(workspace, tarballPath);
    assertInstalledBinaryRunsUsageError(workspace);
  } finally {
    rmSync(workspace.tempDir, { force: true, recursive: true });
  }
});

function createPackageBinWorkspace(): PackageBinWorkspace {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-bin-test-"));

  return {
    appCopyDir: path.join(tempDir, "app"),
    cacheDir: path.join(tempDir, "cache"),
    prefixDir: path.join(tempDir, "prefix"),
    tempDir
  };
}

function preparePackageCopy(workspace: PackageBinWorkspace): void {
  // Copy source without node_modules / cache / dist so that `npm pack` builds
  // a clean tarball; the rmSync below is a belt-and-suspenders guard in case
  // the filter misses nested paths.
  cpSync(repoRoot, workspace.appCopyDir, {
    recursive: true,
    filter(sourcePath) {
      return !(
        sourcePath.includes(`${path.sep}node_modules`) ||
        sourcePath.includes(`${path.sep}.npm-cache`) ||
        sourcePath.endsWith(`${path.sep}dist`)
      );
    }
  });
  rmSync(path.join(workspace.appCopyDir, "dist"), {
    force: true,
    recursive: true
  });
  cpSync(
    path.join(repoRoot, "node_modules"),
    path.join(workspace.appCopyDir, "node_modules"),
    { recursive: true }
  );
}

function packPackage(workspace: PackageBinWorkspace): string {
  const packResult = spawnSync(
    "npm",
    ["pack", "--json", "--cache", workspace.cacheDir],
    {
      cwd: workspace.appCopyDir,
      encoding: "utf8",
      timeout: EXTERNAL_COMMAND_TIMEOUT_MS
    }
  );

  assertSpawnSucceeded(packResult, "npm pack");

  const packOutput = JSON.parse(packResult.stdout);
  const tarballName = packOutput[0]?.filename;

  assert.equal(typeof tarballName, "string");

  return path.join(workspace.appCopyDir, tarballName);
}

function installPackage(
  workspace: PackageBinWorkspace,
  tarballPath: string
): void {
  const installResult = spawnSync(
    "npm",
    [
      "install",
      "-g",
      tarballPath,
      "--prefix",
      workspace.prefixDir,
      "--cache",
      workspace.cacheDir
    ],
    {
      cwd: workspace.appCopyDir,
      encoding: "utf8",
      timeout: EXTERNAL_COMMAND_TIMEOUT_MS
    }
  );

  assertSpawnSucceeded(installResult, "npm install -g");
}

function assertInstalledBinaryRunsUsageError(
  workspace: PackageBinWorkspace
): void {
  const binaryPath = path.join(workspace.prefixDir, "bin", "review");

  assert.ok(existsSync(binaryPath), "installed review executable should exist");

  // Pass only one positional arg to trigger the missing-head_ref usage error;
  // verifies the installed binary runs and produces the correct error output.
  const execResult = spawnSync(binaryPath, ["main"], {
    encoding: "utf8",
    timeout: EXTERNAL_COMMAND_TIMEOUT_MS
  });

  assert.equal(execResult.status, 1, execResult.stderr || execResult.stdout);
  assert.match(execResult.stderr, /head_ref/u);
  assert.match(execResult.stderr, /review <base_ref> <head_ref>/u);
}

function assertSpawnSucceeded(
  result: SpawnSyncReturns<string>,
  commandName: string
): void {
  assert.equal(
    result.status,
    0,
    `${commandName} failed:\n${formatSpawnFailure(result)}`
  );
}

function formatSpawnFailure(result: SpawnSyncReturns<string>): string {
  return [result.error?.message, result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n");
}
