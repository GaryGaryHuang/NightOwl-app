import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReadonlyShellCommand
} from "../../src/services/tool-policy-shell-policy.ts";
import { BASE_PROFILE } from "../helpers/tool-policy-fixture.ts";

function assertAllowedCommands(commands: readonly string[]): void {
  for (const command of commands) {
    assert.equal(evaluateReadonlyShellCommand(command, BASE_PROFILE), undefined, command);
  }
}

test("tool policy shell policy allows representative git inspection commands", () => {
  assertAllowedCommands([
    "git show HEAD:src/app.ts",
    "git status --short",
    "git rev-parse HEAD",
    "git merge-base main feature",
    "git rev-list --count main..HEAD",
    "git ls-files src/",
    "git blame src/app.ts",
    "git grep TODO",
    "git cat-file -p HEAD:src/app.ts"
  ]);
});

test("tool policy shell policy allows representative filesystem and text inspection commands", () => {
  assertAllowedCommands([
    "cat src/app.ts",
    "ls src/",
    "head -20 src/app.ts",
    "tail -20 src/app.ts",
    "find src -name '*.ts'",
    "rg TODO src/",
    "grep 'a|b' src/app.ts",
    "sed -n '1,10p' src/app.ts",
    "cut -d: -f1 src/app.ts",
    "sort src/app.ts | uniq",
    "nl -ba src/app.ts",
    "wc src/app.ts",
    "wc -l src/app.ts",
    "file src/app.ts",
    "stat src/app.ts",
    "tree src/",
    "realpath src/app.ts",
    "basename /workspace/repo/src/app.ts",
    "dirname /workspace/repo/src/app.ts",
    "diff src/old.ts src/new.ts",
    "git log --oneline | awk '{print $1}'"
  ]);
});
