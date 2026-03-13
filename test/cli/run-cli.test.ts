import assert from "node:assert/strict";
import test from "node:test";

import {
  FOUNDATION_PLACEHOLDER_MESSAGE
} from "../../src/app/review-app.ts";
import { runCli } from "../../src/index.ts";

test("runCli forwards parsed input to the app boundary once", async () => {
  const seenRequests = [];
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(
    [
      "main",
      "feature-branch",
      "--repo",
      "./demo",
      "--context",
      "release-note"
    ],
    {
      app: {
        async run(request) {
          seenRequests.push(request);
          return { message: "app-ok" };
        }
      },
      stdout: {
        log(message) {
          stdout.push(String(message));
        }
      },
      stderr: {
        error(message) {
          stderr.push(String(message));
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(seenRequests, [
    {
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./demo",
      userContext: ["release-note"]
    }
  ]);
  assert.deepEqual(stdout, ["app-ok"]);
  assert.deepEqual(stderr, []);
});

test("runCli reports a usage error when head_ref is missing", async () => {
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(["main"], {
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join("\n"), /head_ref/i);
  assert.match(stderr.join("\n"), /review <base_ref> <head_ref>/i);
});

test("runCli returns the foundation placeholder success response", async () => {
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [FOUNDATION_PLACEHOLDER_MESSAGE]);
  assert.deepEqual(stderr, []);
});
