import assert from "node:assert/strict";
import test from "node:test";

import {
  ManifestVerificationError,
  evaluateTestTierManifest,
  loadVerifiedTestTierManifest
} from "../../scripts/verify-test-tier-manifest.mjs";
import { runTestTierCommand } from "../../scripts/test-tier-runner.mjs";

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
    manifest: {
      unit: ["test/core/example.test.ts"],
      integration: [],
      e2e: []
    },
    diskFiles: [
      "test/core/example.test.ts",
      "test/core/missing-from-manifest.test.ts"
    ]
  });

  assert.equal(result.hasErrors, true);
  assert.deepEqual(result.missingFromManifest, ["test/core/missing-from-manifest.test.ts"]);
  assert.deepEqual(result.staleInManifest, []);
});

test("runTestTierCommand exits cleanly when manifest verification fails", () => {
  let spawnCalled = false;

  // ManifestVerificationError is already reported to stderr inside
  // loadVerifiedTestTierManifest, so runTestTierCommand just exits with code 1
  // without re-throwing or spawning the test runner.
  const exitCode = runTestTierCommand({
    args: ["unit"],
    loadManifest: () => {
      throw new ManifestVerificationError();
    },
    spawn: () => {
      spawnCalled = true;
      return { status: 0 };
    },
    logger: {
      error() {},
      log() {}
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(spawnCalled, false);
});

test("runTestTierCommand spawns the manifest-defined source test files for the requested tier", () => {
  let receivedCommand;
  let receivedArgs;
  let receivedOptions;

  const exitCode = runTestTierCommand({
    args: ["integration"],
    loadManifest: () => ({
      unit: [],
      integration: ["test/app/review-app.test.ts"],
      e2e: []
    }),
    // All external dependencies are injected so the test can assert the exact
    // spawn contract without executing a real node subprocess.
    spawn: (command, args, options) => {
      receivedCommand = command;
      receivedArgs = args;
      receivedOptions = options;
      return { status: 0 };
    },
    execPath: "node",
    cwd: "/tmp/nightowl-app",
    logger: {
      error() {},
      log() {}
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(receivedCommand, "node");
  // Source test files are passed directly as positional arguments after --test;
  // Node's built-in test runner resolves them from the cwd.
  assert.deepEqual(receivedArgs, ["--test", "test/app/review-app.test.ts"]);
  // stdio: "inherit" forwards test runner output directly to the terminal
  // without buffering so progress and failures are visible in real time.
  assert.deepEqual(receivedOptions, {
    cwd: "/tmp/nightowl-app",
    stdio: "inherit"
  });
});

test("runTestTierCommand returns exit code 1 and logs the error when spawn fails to start", () => {
  const loggedErrors: unknown[] = [];
  const spawnError = new Error("spawn ENOENT");

  const exitCode = runTestTierCommand({
    args: ["unit"],
    loadManifest: () => ({
      unit: ["test/core/example.test.ts"],
      integration: [],
      e2e: []
    }),
    spawn: () => ({ status: null, error: spawnError }),
    logger: {
      log() {},
      error(message) { loggedErrors.push(message); }
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0], spawnError);
});

test("loadVerifiedTestTierManifest routes all output through the injected logger", () => {
  const logged: string[] = [];
  const errors: string[] = [];

  // The on-disk manifest must be valid for the test suite to run at all, so
  // this call should always succeed and emit exactly one success log line.
  loadVerifiedTestTierManifest({
    logger: {
      log(message) { logged.push(message); },
      error(message) { errors.push(message); }
    }
  });

  // The success confirmation must reach the injected logger, not console.
  assert.equal(logged.length, 1);
  assert.match(logged[0], /✔ test-tier-manifest verified/);
  // No errors should have been emitted on a healthy manifest.
  assert.deepEqual(errors, []);
});