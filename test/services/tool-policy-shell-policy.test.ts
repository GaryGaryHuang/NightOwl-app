import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReadonlyShellCommand,
  READONLY_BASH_DENY_REASON
} from "../../src/services/tool-policy-shell-policy.ts";
import { BASE_PROFILE } from "../helpers/tool-policy-fixture.ts";

// The shell policy splits on unquoted `|` and validates each segment against
// a whitelist of known-safe commands. This test confirms pipelines of allowed
// commands pass, including normalised whitespace around `|`.
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

// Lexical guards for `||`, `;`, and `&&` are pre-applied before pipe splitting
// so that logical-or and command sequencing are caught even when the tokens
// look like they could be part of a pipe chain.
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

// `|` inside quotes or preceded by a backslash is a literal character, not a
// pipe operator. The policy must treat these as single-segment commands and
// validate them as such, allowing grep regex patterns to work correctly.
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

// Malformed quoting and dangling backslashes are rejected conservatively
// rather than making best-effort interpretations that could allow bypass.
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

// `||` inside quotes is still denied because the lexical `||` guard is applied
// before quote parsing — this is an intentional conservative trade-off.
test("tool policy shell policy keeps quoted double-pipe denied as an unchanged lexical guardrail", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand('grep "foo||bar"', BASE_PROFILE),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

// ---------------------------------------------------------------------------
// ALLOWED_BASH_PREFIXES — explicit allow test for each previously untested entry
// ---------------------------------------------------------------------------

test("tool policy shell policy allows all ALLOWED_BASH_PREFIXES entries", () => {
  // git sub-commands not covered by existing tests
  assert.equal(evaluateReadonlyShellCommand("git show HEAD:src/app.ts", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("git status --short", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("git rev-parse HEAD", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("git merge-base main feature", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("git rev-list --count main..HEAD", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("git ls-files src/", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("git blame src/app.ts", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("git grep TODO", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("git cat-file -p HEAD:src/app.ts", BASE_PROFILE), undefined);
  // standalone tools not covered by existing tests
  assert.equal(evaluateReadonlyShellCommand("ls src/", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("tail -20 src/app.ts", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("find src -name '*.ts'", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("rg TODO src/", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("sed -n '1,10p' src/app.ts", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("cut -d: -f1 src/app.ts", BASE_PROFILE), undefined);
  assert.equal(evaluateReadonlyShellCommand("uniq", BASE_PROFILE), undefined);
});

// ---------------------------------------------------------------------------
// FSM edge cases — splitTopLevelPipelineSegments boundary conditions
// ---------------------------------------------------------------------------

test("tool policy shell policy denies empty and whitespace-only commands", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand("", BASE_PROFILE),
    { permissionDecision: "deny", permissionDecisionReason: READONLY_BASH_DENY_REASON }
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand("   ", BASE_PROFILE),
    { permissionDecision: "deny", permissionDecisionReason: READONLY_BASH_DENY_REASON }
  );
});

test("tool policy shell policy treats pipe inside double quotes as literal, not a pipeline separator", () => {
  assert.equal(evaluateReadonlyShellCommand('grep "a|b" src/app.ts', BASE_PROFILE), undefined);
});

test("tool policy shell policy treats pipe inside single quotes as literal, not a pipeline separator", () => {
  assert.equal(evaluateReadonlyShellCommand("grep 'a|b' src/app.ts", BASE_PROFILE), undefined);
});

test("tool policy shell policy denies unmatched double quote (fail-closed FSM)", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand('grep "unclosed src/app.ts', BASE_PROFILE),
    { permissionDecision: "deny", permissionDecisionReason: READONLY_BASH_DENY_REASON }
  );
});

test("tool policy shell policy denies unmatched single quote (fail-closed FSM)", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand("grep 'unclosed src/app.ts", BASE_PROFILE),
    { permissionDecision: "deny", permissionDecisionReason: READONLY_BASH_DENY_REASON }
  );
});

// ---------------------------------------------------------------------------
// resolvePathToken edge cases — ~, ~/path, relative path without ./
// ---------------------------------------------------------------------------

test("tool policy shell policy denies ~ (tilde resolves to HOME, outside repoRoot)", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand("cat ~", BASE_PROFILE),
    { permissionDecision: "deny", permissionDecisionReason: READONLY_BASH_DENY_REASON }
  );
});

test("tool policy shell policy denies ~/path (tilde-relative path outside repoRoot)", () => {
  assert.deepEqual(
    evaluateReadonlyShellCommand("cat ~/secret.txt", BASE_PROFILE),
    { permissionDecision: "deny", permissionDecisionReason: READONLY_BASH_DENY_REASON }
  );
});

test("tool policy shell policy allows relative path containing slash without ./ prefix when within repoRoot", () => {
  assert.equal(evaluateReadonlyShellCommand("cat src/app.ts", BASE_PROFILE), undefined);
});

