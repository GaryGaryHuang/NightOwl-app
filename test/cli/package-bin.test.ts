import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("package exposes an installable review executable", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  );

  assert.equal(packageJson.bin.review, "./dist/bin/review.js");

  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-bin-test-"));
  const appCopyDir = path.join(tempDir, "app");
  const cacheDir = path.join(tempDir, "cache");
  const prefixDir = path.join(tempDir, "prefix");

  cpSync(repoRoot, appCopyDir, {
    recursive: true,
    filter(sourcePath) {
      return !(
        sourcePath.includes(`${path.sep}node_modules`) ||
        sourcePath.includes(`${path.sep}.npm-cache`) ||
        sourcePath.endsWith(`${path.sep}dist`)
      );
    }
  });
  rmSync(path.join(appCopyDir, "dist"), { force: true, recursive: true });

  const packResult = spawnSync(
    "npm",
    ["pack", "--json", "--cache", cacheDir],
    {
      cwd: appCopyDir,
      encoding: "utf8"
    }
  );

  assert.equal(
    packResult.status,
    0,
    packResult.stderr || packResult.stdout
  );

  const packOutput = JSON.parse(packResult.stdout);
  const tarballName = packOutput[0]?.filename;

  assert.equal(typeof tarballName, "string");

  const tarballPath = path.join(appCopyDir, tarballName);

  const installResult = spawnSync(
    "npm",
    [
      "install",
      "-g",
      tarballPath,
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

  try {
    const execResult = spawnSync(binaryPath, ["main"], {
      encoding: "utf8"
    });

    assert.equal(execResult.status, 1, execResult.stderr || execResult.stdout);
    assert.match(execResult.stderr, /head_ref/u);
    assert.match(execResult.stderr, /review <base_ref> <head_ref>/u);
  } finally {
    rmSync(tarballPath, { force: true });
  }
});
