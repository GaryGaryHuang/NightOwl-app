import assert from "node:assert/strict";
import test from "node:test";

import {
  ManifestVerificationError,
  evaluateTestTierManifest
} from "../../scripts/verify-test-tier-manifest.mjs";
import { runTestTierCommand } from "../../scripts/test-tier-runner.mjs";

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
  assert.deepEqual(receivedArgs, ["--test", "test/app/review-app.test.ts"]);
  assert.deepEqual(receivedOptions, {
    cwd: "/tmp/nightowl-app",
    stdio: "inherit"
  });
});