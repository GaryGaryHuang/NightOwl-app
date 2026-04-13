import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..", "..");
const shouldRunSmoke = process.env.NIGHTOWL_RUN_CHECK_SMOKE === "1";
const SMOKE_COMMAND_TIMEOUT_MS = 120_000;
const binaryPath = path.join(repoRoot, "dist/bin/review.js");

test(
  "review --check succeeds against a real Copilot CLI environment",
  { skip: !shouldRunSmoke },
  () => {
    assert.ok(
      existsSync(binaryPath),
      "dist/bin/review.js should exist; run `npm run build` before enabling this smoke test."
    );

    const result = spawnSync("node", [binaryPath, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
      timeout: SMOKE_COMMAND_TIMEOUT_MS
    });

    assert.equal(result.status, 0, formatSpawnFailure(result));
    assert.equal(result.stdout.trim(), "GitHub Copilot is available.");
    assert.equal(result.stderr.trim(), "");
  }
);

function formatSpawnFailure(result: SpawnSyncReturns<string>): string {
  return [result.error?.message, result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n");
}
