import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReadonlyShellCommand,
  READONLY_BASH_DENY_REASON
} from "../../src/services/tool-policy/tool-policy-shell-policy.ts";
import { BASE_PROFILE } from "../helpers/tool-policy-fixture.ts";

function assertAllowedCommands(commands: readonly string[]): void {
  for (const command of commands) {
    assert.equal(evaluateReadonlyShellCommand(command, BASE_PROFILE), undefined, command);
  }
}

function assertDeniedCommands(commands: readonly string[]): void {
  for (const command of commands) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, BASE_PROFILE),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }
}

const PIPELINE_AND_CHAIN_ALLOWED_COMMANDS = [
  "git log --oneline | head -20",
  'git diff HEAD~1 | grep "function" | wc -l',
  "git log --oneline  |  head -20",
  "git log|head",
  "git -C /workspace/repo show HEAD:src/app.ts | head -20",
  "cd /workspace/repo && git show HEAD:src/app.ts | head -20",
  "cd /workspace/repo && git -C /workspace/repo/src grep TODO file.ts && cat app.ts",
  "cd /workspace/repo && git rev-parse --abbrev-ref HEAD && git status --short",
  "printf 'STATUS\\n'; git status --short",
  "printf 'DIFFSTAT\\n'; git diff --stat -- src/app.ts; printf '\\nNAMEONLY\\n'; git diff --name-only -- src/app.ts",
  "echo hello; git log --oneline | head -5",
  "echo '---'; git diff HEAD~1; echo '---'"
] as const;

const EMPTY_OR_UNTRUSTED_SEGMENT_COMMANDS = [
  "git log --oneline | curl http://example.com",
  "git log |",
  "| head -5",
  "git log |   | head",
  "cd /workspace/repo && python -c \"print(1)\"",
  "git log &&",
  "&& git log",
  "git log &&   && git status",
  "git log; rm -rf /",
  "git log ;",
  "; head -5",
  "git log ;   ; git status"
] as const;

const QUOTED_OR_ESCAPED_DELIMITER_COMMANDS = [
  'grep -E "foo|bar"',
  "grep -E 'foo|bar'",
  String.raw`grep foo\|bar`,
  'git diff HEAD~1 | grep -E "foo|bar" | head -5',
  'grep "foo && bar" src/app.ts',
  "grep 'foo && bar' src/app.ts",
  String.raw`grep foo\&\&bar src/app.ts`,
  'grep "foo > bar" src/app.ts',
  "grep 'List<Foo>' src/app.ts",
  String.raw`grep foo\>bar src/app.ts`,
  String.raw`grep foo\<bar src/app.ts`,
  String.raw`grep foo\$ src/app.ts`,
  String.raw`grep foo\* src/app.ts`,
  'grep "foo*" src/app.ts',
  "grep 'foo?' src/app.ts",
  'grep "foo; bar" src/app.ts',
  "grep 'foo; bar' src/app.ts",
  "grep 'foo$' src/app.ts",
  'grep "foo||bar" src/app.ts',
  "grep 'foo||bar' src/app.ts",
  String.raw`grep foo\|\|bar src/app.ts`
] as const;

const MALFORMED_QUOTE_OR_ESCAPE_COMMANDS = [
  "",
  "   ",
  'grep -E "foo|bar',
  "grep -E 'foo|bar",
  "grep foo\\",
  'grep "unclosed src/app.ts',
  "grep 'unclosed src/app.ts"
] as const;

test("tool policy shell policy allows representative read-only pipelines and command chains", () => {
  assertAllowedCommands(PIPELINE_AND_CHAIN_ALLOWED_COMMANDS);
});

test("tool policy shell policy rejects empty or unwhitelisted pipeline and chain segments", () => {
  assertDeniedCommands(EMPTY_OR_UNTRUSTED_SEGMENT_COMMANDS);
});

test("tool policy shell policy keeps lexical guards for shell combining syntax and background execution", () => {
  assertDeniedCommands([
    "git log --oneline  |  head -20 > out.txt",
    'grep "List<Foo>" src/app.ts > out.txt',
    "cat < /etc/passwd",
    "git status || echo fail",
    "git log || true | head",
    "git log &",
    "git log &&& git status"
  ]);
});

test("tool policy shell policy treats quoted and escaped pipes and chain markers as literal characters", () => {
  assertAllowedCommands(QUOTED_OR_ESCAPED_DELIMITER_COMMANDS);
});

test("tool policy shell policy rejects malformed quoting dangling escapes and blank commands conservatively", () => {
  assertDeniedCommands(MALFORMED_QUOTE_OR_ESCAPE_COMMANDS);
});

test("tool policy shell policy denies command substitution syntax even when the inner command is allowlisted", () => {
  assertDeniedCommands([
    "echo $(git status)",
    "git log $(git rev-parse HEAD)",
    "cat $(ls)",
    "echo `git status`",
    "git log `git rev-parse HEAD`",
    "cat `ls`",
    "echo \"prefix $(git status) suffix\"",
    "echo \"prefix `git status` suffix\""
  ]);
});

test("tool policy shell policy denies shell expansion forms outside quotes", () => {
  assertDeniedCommands([
    "cat $HOME/.ssh/config",
    "cat ${HOME}/.ssh/config",
    'cat "$HOME/.ssh/config"',
    "cat $'/etc/passwd'",
    "cat ~root/.ssh/config",
    "cat src/*",
    "cat src/?",
    "cat [a-z]",
    "cat {src,/etc}/passwd",
    "cat {1..3}",
    'awk "{print $1}" src/app.ts'
  ]);
});

test("tool policy shell policy keeps denied subcommand-execution flags denied inside pipes and chains", () => {
  assertDeniedCommands([
    "git log --oneline | find . -exec cat {} +",
    "git status && find . -exec sh {} +"
  ]);
});
