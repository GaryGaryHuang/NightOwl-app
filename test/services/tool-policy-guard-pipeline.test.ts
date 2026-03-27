import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReadonlyShellCommand,
  READONLY_BASH_DENY_REASON
} from "../../src/services/tool-policy-shell-policy.ts";
import { BASE_PROFILE } from "../helpers/tool-policy-fixture.ts";

test("tool policy shell policy allows whitelisted commands and pipeline shapes", () => {
  assert.equal(
    evaluateReadonlyShellCommand(
      "git log --oneline | head -20",
      BASE_PROFILE
    ),
    undefined
  );
  assert.equal(
    evaluateReadonlyShellCommand(
      'git diff HEAD~1 | grep "function" | wc -l',
      BASE_PROFILE
    ),
    undefined
  );
  assert.equal(
    evaluateReadonlyShellCommand("git log --oneline  |  head -20", BASE_PROFILE),
    undefined
  );
  assert.equal(
    evaluateReadonlyShellCommand("git log|head", BASE_PROFILE),
    undefined
  );
});

test("tool policy shell policy rejects segments that are not whitelisted or are empty", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand(
      "git log --oneline | curl http://example.com",
      BASE_PROFILE
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("git log |", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("| head -5", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("git log |   | head", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

test("tool policy shell policy rejects dangerous flags and out-of-boundary path arguments", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand(
      "cat /etc/passwd | head -5",
      BASE_PROFILE
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand(
      "git log --oneline | sort --output=result.txt",
      BASE_PROFILE
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("cat ../secret.txt", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

test("tool policy shell policy keeps lexical guards for logical-or and shell combining syntax", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand("git status || echo fail", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("git log || true | head", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("git log; rm -rf /", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

test("tool policy shell policy allows literal pipes inside quoted or escaped segments", () => {
  assert.equal(
    evaluateReadonlyShellCommand('grep -E "foo|bar"', BASE_PROFILE),
    undefined
  );
  assert.equal(
    evaluateReadonlyShellCommand("grep -E 'foo|bar'", BASE_PROFILE),
    undefined
  );
  assert.equal(
    evaluateReadonlyShellCommand(String.raw`grep foo\|bar`, BASE_PROFILE),
    undefined
  );
  assert.equal(
    evaluateReadonlyShellCommand(
      'git diff HEAD~1 | grep -E "foo|bar" | head -5',
      BASE_PROFILE
    ),
    undefined
  );
});

test("tool policy shell policy handles repo-relative path arguments against the command cwd", () => {
  assert.equal(
    evaluateReadonlyShellCommand(
      'grep -E "foo|bar" src/file.ts',
      BASE_PROFILE,
      "/workspace/repo"
    ),
    undefined
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand(
      'grep -E "foo|bar" src/file.ts',
      BASE_PROFILE,
      "/tmp"
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

test("tool policy shell policy denies malformed quoting and dangling escapes conservatively", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand('grep -E "foo|bar', BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("grep -E 'foo|bar", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("grep foo\\", BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

test("tool policy shell policy keeps quoted double-pipe denied as an unchanged lexical guardrail", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand('grep "foo||bar"', BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});
