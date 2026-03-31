import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..", "..");
const shouldRunSmoke = process.env.NIGHTOWL_RUN_CHECK_SMOKE === "1";

test(
  "review --check succeeds against a real Copilot CLI environment",
  { skip: !shouldRunSmoke },
  () => {
    const result = spawnSync("node", ["dist/bin/review.js", "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), "GitHub Copilot is available.");
    assert.equal(result.stderr.trim(), "");
  }
);