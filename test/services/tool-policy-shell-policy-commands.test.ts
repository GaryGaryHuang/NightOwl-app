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

const READONLY_REVIEW_COMMAND_GROUPS = [
  {
    name: "git changeset and history inspection",
    commands: [
      "git show HEAD:src/app.ts",
      "git --no-pager diff HEAD~1",
      "git --no-pager show HEAD:src/app.ts",
      "git status --short",
      "git rev-parse HEAD",
      "git merge-base main feature",
      "git rev-list --count main..HEAD",
      "git ls-files src/",
      "git blame src/app.ts",
      "git grep TODO",
      "git cat-file -p HEAD:src/app.ts"
    ]
  },
  {
    name: "repo-local file and text inspection",
    commands: [
      "cat src/app.ts",
      "ls src/",
      "head -20 src/app.ts",
      "tail -20 src/app.ts",
      "find src -name '*.ts'",
      "rg TODO src/",
      "grep 'a|b' src/app.ts",
      "sed -n '1,10p' src/app.ts",
      "wc -l src/app.ts"
    ]
  },
  {
    name: "lightweight text and path processing",
    commands: [
      "nl -ba src/app.ts",
      "file src/app.ts",
      "sort src/app.ts",
      "wc src/app.ts"
    ]
  }
] as const;

for (const group of READONLY_REVIEW_COMMAND_GROUPS) {
  test(`tool policy shell policy allows ${group.name} commands`, () => {
    assertAllowedCommands(group.commands);
  });
}

test("tool policy shell policy allows printf and echo for output formatting", () => {
  assertAllowedCommands([
    "printf 'hello\\n'",
    "echo hello",
    "echo '---'",
    "printf '%s\\n' foo"
  ]);
});

test("tool policy shell policy denies sed without required -n flag", () => {
  assertDeniedCommands([
    "sed 's/foo/bar/' src/app.ts",
    "sed -e 's/foo/bar/' src/app.ts"
  ]);
});

test("tool policy shell policy denies sed with in-place edit flags", () => {
  assertDeniedCommands([
    "sed -n -i 's/foo/bar/' src/app.ts",
    "sed -n --in-place 's/foo/bar/' src/app.ts"
  ]);
});

test("tool policy shell policy denies find with destructive or subcommand-execution predicates", () => {
  assertDeniedCommands([
    "find . -name '*.ts' -delete",
    "find . -name '*.ts' -ok rm {} +",
    "find . -name '*.ts' -okdir rm {} +",
    "find . -exec sh {} +",
    "find . -name '*.ts' -exec cat {} +",
    "find . -execdir sh {} +"
  ]);
});

test("tool policy shell policy preserves non-snapshot utility commands", () => {
  assertAllowedCommands([
    "awk '{print $1}' src/app.ts",
    "tree src/",
    "realpath src/app.ts",
    "basename /workspace/repo/src/app.ts",
    "dirname /workspace/repo/src/app.ts",
    "cut -d: -f1 src/app.ts",
    "sort src/app.ts | uniq",
    "stat src/app.ts",
    "diff src/old.ts src/new.ts",
    "git log --oneline | awk '{print $1}'",
    "rg --pre=tools/pre.sh token src/app.ts"
  ]);
});

test("tool policy shell policy allows safe find inspection predicates", () => {
  assertAllowedCommands([
    "find . -name '*.ts' -type f",
    "find . -name '*.{ts,tsx}' -type f",
    "find . -executable -type f"
  ]);
});

test("tool policy shell policy denies write or output flags on otherwise allowlisted commands", () => {
  assertDeniedCommands([
    "git log --oneline | sort --output=result.txt",
    "git show -exec sh {} +",
    "sort -o result.txt src/app.ts"
  ]);
});

test("tool policy shell policy denies unrecognised git subcommands", () => {
  assertDeniedCommands([
    "git --no-pager push origin main",
    "git -c core.pager=cat diff HEAD~1",
    "git push origin main",
    "git commit -m 'msg'",
    "git checkout -b new-branch",
    "git reset --hard HEAD~1",
    "git stash"
  ]);
});
