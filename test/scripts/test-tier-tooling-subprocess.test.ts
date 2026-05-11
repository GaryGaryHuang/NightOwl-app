import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadVerifiedTestTierManifest
} from "../../scripts/verify-test-tier-manifest.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

test("verify-test-tier-manifest.mjs exits 0 against the real repo manifest when invoked as a subprocess", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "verify-test-tier-manifest.mjs")],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /✔ test-tier-manifest verified/);
});

test("test-tier-runner.mjs exits 1 with usage on stderr when invoked as a subprocess with an invalid tier", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "test-tier-runner.mjs"), "not-a-tier"],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Usage: node \.\/scripts\/test-tier-runner\.mjs <unit\|integration\|e2e\|all>/
  );
});

test("loadVerifiedTestTierManifest routes all output through the injected logger for the real manifest", () => {
  const logged: string[] = [];
  const errors: string[] = [];

  loadVerifiedTestTierManifest({
    logger: {
      log(message) { logged.push(message); },
      error(message) { errors.push(message); }
    }
  });

  assert.equal(logged.length, 1);
  assert.match(logged[0], /✔ test-tier-manifest verified/);
  assert.deepEqual(errors, []);
});
