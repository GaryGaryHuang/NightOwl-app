import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReadonlyShellCommand,
  READONLY_BASH_DENY_REASON
} from "../../src/services/tool-policy-shell-policy.ts";
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

test("tool policy shell policy denies dangerous flags and out-of-boundary path arguments", () => {
  assertDeniedCommands([
    "cat /etc/passwd | head -5",
    "git log --oneline | sort --output=result.txt",
    "cat ../secret.txt",
    "nl /etc/passwd",
    "diff /etc/hosts src/app.ts"
  ]);
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

test("tool policy shell policy blocks subcommand execution forms while allowing safe find usage", () => {
  assertDeniedCommands([
    "find . -exec sh {} +",
    "find . -name '*.ts' -exec cat {} +",
    "find . -execdir sh {} +",
    "git log --oneline | find . -exec cat {} +",
    "git status && find . -exec sh {} +",
    "git show -exec sh {} +"
  ]);

  assertAllowedCommands([
    "find . -name '*.ts' -type f",
    "find . -executable -type f"
  ]);
});
