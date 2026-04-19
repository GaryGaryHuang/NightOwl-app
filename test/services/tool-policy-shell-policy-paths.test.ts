import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReadonlyShellCommand,
  READONLY_BASH_DENY_REASON
} from "../../src/services/tool-policy/tool-policy-shell-policy.ts";
import { BASE_PROFILE } from "../helpers/tool-policy-fixture.ts";

function assertAllowedCommands(
  commands: readonly string[],
  commandCwd?: string
): void {
  for (const command of commands) {
    assert.equal(
      evaluateReadonlyShellCommand(command, BASE_PROFILE, commandCwd),
      undefined,
      command
    );
  }
}

function assertDeniedCommands(
  commands: readonly string[],
  commandCwd?: string
): void {
  for (const command of commands) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, BASE_PROFILE, commandCwd),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }
}

const OUT_OF_BOUNDARY_PATH_COMMANDS = [
  "cat /etc/passwd | head -5",
  "cat ../secret.txt",
  "git -C /tmp diff HEAD~1",
  "nl /etc/passwd",
  "diff /etc/hosts src/app.ts"
] as const;

test("tool policy shell policy denies out-of-boundary path arguments", () => {
  assertDeniedCommands(OUT_OF_BOUNDARY_PATH_COMMANDS);
});

test("tool policy shell policy resolves repo-relative path arguments against the effective cwd", () => {
  assertAllowedCommands([
    'grep -E "foo|bar" src/file.ts',
    "cat src/app.ts"
  ], "/workspace/repo");

  assertDeniedCommands([
    'grep -E "foo|bar" src/file.ts'
  ], "/tmp");
});

test("tool policy shell policy only allows absolute git -C paths and rejects malformed git -C prefixes", () => {
  assertAllowedCommands([
    "git -C /workspace/repo diff HEAD~1",
    "git -C /workspace/repo grep TODO src/file.ts"
  ]);

  assertDeniedCommands([
    "git -C src diff HEAD~1",
    "git -C diff HEAD~1",
    "git -C /workspace/repo"
  ]);
});

test("tool policy shell policy denies home-relative paths outside the repo boundary", () => {
  assertDeniedCommands([
    "cat ~",
    "cat ~/secret.txt"
  ]);
});

test("tool policy shell policy propagates cd-derived cwd and enforces cd path boundaries", () => {
  assertAllowedCommands([
    "cd /workspace/repo && cat src/app.ts",
    "cd /workspace/repo && cd src && cat app.ts",
    "cd -P /workspace/repo && git status"
  ]);

  assertAllowedCommands([
    "cd src && cat app.ts"
  ], "/workspace/repo");

  assertDeniedCommands([
    "cd && git status",
    "cd /tmp && ls"
  ]);
});
