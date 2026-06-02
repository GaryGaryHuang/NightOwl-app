import assert from "node:assert/strict";
import test from "node:test";

import {
  ManifestVerificationError,
  evaluateTestTierManifest
} from "../../scripts/verify-test-tier-manifest.mjs";
import { runTestTierCommand } from "../../scripts/test-tier-runner.mjs";

interface TestTierManifest extends Record<string, string[]> {
  unit: string[];
  integration: string[];
  e2e: string[];
}

function createManifest(
  overrides: Partial<TestTierManifest> = {}
): TestTierManifest {
  return {
    unit: [],
    integration: [],
    e2e: [],
    ...overrides
  };
}

// Parity checks (missingFromManifest / staleInManifest) are intentionally
// suppressed when schema validation fails: the manifest paths are untrusted at
// that point, so running disk comparison would produce misleading noise rather
// than actionable drift information.
test("evaluateTestTierManifest suppresses parity noise when manifest schema is invalid", () => {
  const result = evaluateTestTierManifest({
    manifest: {},
    diskFiles: ["test/core/example.test.ts"]
  });

  assert.equal(result.hasErrors, true);
  assert.deepEqual(result.missingFromManifest, []);
  assert.deepEqual(result.staleInManifest, []);
  assert.match(
    result.allSchemaViolations.join("\n"),
    /Missing top-level keys: unit, integration, e2e\./
  );
});

test("evaluateTestTierManifest still reports parity drift when manifest shape is canonical", () => {
  const result = evaluateTestTierManifest({
    manifest: createManifest({
      unit: ["test/core/example.test.ts"]
    }),
    diskFiles: [
      "test/core/example.test.ts",
      "test/core/missing-from-manifest.test.ts"
    ]
  });

  assert.equal(result.hasErrors, true);
  assert.deepEqual(result.missingFromManifest, ["test/core/missing-from-manifest.test.ts"]);
  assert.deepEqual(result.staleInManifest, []);
});

test("runTestTierCommand exits 1 without spawning or re-throwing when manifest verification or spawn startup fails", () => {
  // ManifestVerificationError is already reported to stderr inside
  // loadVerifiedTestTierManifest, so runTestTierCommand just exits with code 1
  // without spawning anything or re-throwing.
  let spawnCalledOnVerificationFailure = false;
  const verificationExit = runTestTierCommand({
    args: ["unit"],
    loadManifest: () => {
      throw new ManifestVerificationError();
    },
    spawn: () => {
      spawnCalledOnVerificationFailure = true;
      return { status: 0 };
    },
    logger: { error() {}, log() {} }
  });
  assert.equal(verificationExit, 1);
  assert.equal(spawnCalledOnVerificationFailure, false);

  // When the spawn itself fails to start, the runner must surface the error
  // through the injected logger and still return exit code 1 (not throw).
  const loggedErrors: unknown[] = [];
  const spawnError = new Error("spawn ENOENT");
  const spawnFailureExit = runTestTierCommand({
    args: ["unit"],
    loadManifest: () => createManifest({
      unit: ["test/core/example.test.ts"]
    }),
    spawn: () => ({ status: null, error: spawnError }),
    logger: {
      log() {},
      error(message) { loggedErrors.push(message); }
    }
  });
  assert.equal(spawnFailureExit, 1);
  assert.deepEqual(loggedErrors, ["spawn ENOENT"]);
});

test("runTestTierCommand spawns the manifest-defined files for a tier and concatenates all tiers in canonical order for 'all'", () => {
  // Single tier: spawn must receive --test followed by exactly the manifest
  // entries for the requested tier, executed in the cwd with inherited stdio.
  let receivedCommand: string | undefined;
  let receivedArgs: string[] | undefined;
  let receivedOptions: { cwd: string; stdio: string } | undefined;

  const singleTierExit = runTestTierCommand({
    args: ["integration"],
    loadManifest: () => createManifest({
      integration: ["test/app/review-app-progress.test.ts"]
    }),
    spawn: (command, args, options) => {
      receivedCommand = command;
      receivedArgs = args;
      receivedOptions = options;
      return { status: 0 };
    },
    execPath: "node",
    cwd: "/tmp/nightowl-app",
    logger: { error() {}, log() {} }
  });

  assert.equal(singleTierExit, 0);
  assert.equal(receivedCommand, "node");
  assert.deepEqual(receivedArgs, ["--test", "test/app/review-app-progress.test.ts"]);
  // stdio: "inherit" forwards test runner output directly to the terminal
  // without buffering so progress and failures are visible in real time.
  assert.deepEqual(receivedOptions, {
    cwd: "/tmp/nightowl-app",
    stdio: "inherit"
  });

  // "all": files concatenated in canonical tier order unit → integration → e2e.
  let allTierArgs: string[] | undefined;
  const allTierExit = runTestTierCommand({
    args: ["all"],
    loadManifest: () => createManifest({
      unit: ["test/core/alpha.test.ts"],
      integration: ["test/app/beta.test.ts"],
      e2e: ["test/cli/gamma.test.ts"]
    }),
    spawn: (_command, args) => {
      allTierArgs = args;
      return { status: 0 };
    },
    execPath: "node",
    cwd: "/tmp/nightowl-app",
    logger: { error() {}, log() {} }
  });

  assert.equal(allTierExit, 0);
  assert.deepEqual(allTierArgs, [
    "--test",
    "test/core/alpha.test.ts",
    "test/app/beta.test.ts",
    "test/cli/gamma.test.ts"
  ]);
});
