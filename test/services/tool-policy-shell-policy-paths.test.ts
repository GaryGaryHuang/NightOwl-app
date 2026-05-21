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
  'cat "/etc/passwd"',
  "cat '/etc/passwd'",
  "cat ../secret.txt",
  "git -C /tmp diff HEAD~1",
  'git -C "/tmp" diff HEAD~1',
  'grep root "/etc/passwd"',
  "nl /etc/passwd",
  "diff /etc/hosts src/app.ts"
] as const;

const SNAPSHOT_PROFILE = {
  repoRoot: "/tmp/nightowl-source-snapshot",
  reviewOutputRoot: "/workspace/repo/.nightowl/review",
  sourceBaseRef: "6e199e57ec5e101ba9bd0347a37e9508a9b15bcc",
  sourceHeadRef: "c1d76cc53b8ded1562c6f1064fb66f582841bd39"
} as const;

test("tool policy shell policy denies out-of-boundary path arguments", () => {
  assertDeniedCommands(OUT_OF_BOUNDARY_PATH_COMMANDS);
});

test("tool policy shell policy resolves repo-relative path arguments against the effective cwd", () => {
  assertAllowedCommands([
    'grep -E "foo|bar" src/file.ts',
    'grep TODO "src/app.ts"',
    "cat src/app.ts"
  ], "/workspace/repo");

  assertDeniedCommands([
    'grep -E "foo|bar" src/file.ts'
  ], "/tmp");
});

test("tool policy shell policy only allows absolute git -C paths and rejects malformed git -C prefixes", () => {
  assertAllowedCommands([
    "git -C /workspace/repo diff HEAD~1",
    'git -C "/workspace/repo" diff HEAD~1',
    "git --no-pager -C /workspace/repo diff HEAD~1",
    "git -C /workspace/repo --no-pager diff HEAD~1",
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

test("tool policy shell policy supports separate snapshot source and original review output roots", () => {
  for (const command of [
    "cat /tmp/nightowl-source-snapshot/src/app.ts",
    "git -C /tmp/nightowl-source-snapshot diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc...c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src/app.ts",
    "git -C /tmp/nightowl-source-snapshot diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src/app.ts",
    "cat /workspace/repo/.nightowl/review/previous/index.md",
    "cd /workspace/repo/.nightowl/review && ls previous"
  ]) {
    assert.equal(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      undefined,
      command
    );
  }

  for (const command of [
    "cat /workspace/repo/src/app.ts",
    "git -C /workspace/repo diff base...head",
    "git -C /workspace/repo/.nightowl/review show HEAD:src/app.ts",
    "cd /workspace/repo/.nightowl/review && git show HEAD:src/app.ts",
    "cd /workspace/repo && ls src"
  ]) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }
});

test("tool policy shell policy validates SDK cwd before allowing bare path arguments", () => {
  assert.equal(
    evaluateReadonlyShellCommand(
      "cat app.ts",
      SNAPSHOT_PROFILE,
      "/tmp/nightowl-source-snapshot/src"
    ),
    undefined
  );
  assert.deepEqual(
    evaluateReadonlyShellCommand(
      "cat app.ts",
      SNAPSHOT_PROFILE,
      "/workspace/repo/src"
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
});

test("tool policy shell policy allows only run-ref-bound Git evidence forms in snapshot-backed sessions", () => {
  for (const command of [
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc...c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src/app.ts",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src/app.ts",
    "git show HEAD:src/app.ts",
    "git show @:src/app.ts",
    "git show 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc:src/app.ts",
    "git show c1d76cc53b8ded1562c6f1064fb66f582841bd39:src/app.ts",
    "git grep token HEAD -- src/app.ts",
    "git grep -n token c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src"
  ]) {
    assert.equal(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      undefined,
      command
    );
  }

  for (const command of [
    "git show feature:src/app.ts",
    "git diff main...feature -- src/app.ts",
    "git diff c1d76cc53b8ded1562c6f1064fb66f582841bd39 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc -- src/app.ts",
    "git diff c1d76cc53b8ded1562c6f1064fb66f582841bd39...6e199e57ec5e101ba9bd0347a37e9508a9b15bcc -- src/app.ts",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc...c1d76cc53b8ded1562c6f1064fb66f582841bd39",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc c1d76cc53b8ded1562c6f1064fb66f582841bd39",
    "git grep TODO feature -- src/app.ts",
    "git grep --full-name TODO c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src",
    "git status --short",
    "git cat-file -p HEAD:src/app.ts"
  ]) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }
});

test("tool policy shell policy denies snapshot git diff when resolved source refs are unavailable", () => {
  const profileWithoutSourceRefs = {
    repoRoot: SNAPSHOT_PROFILE.repoRoot,
    reviewOutputRoot: SNAPSHOT_PROFILE.reviewOutputRoot
  };

  for (const command of [
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc...c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src/app.ts",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src/app.ts"
  ]) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, profileWithoutSourceRefs),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }
});

test("tool policy shell policy validates snapshot Git object paths and ambiguous shell path tokens", () => {
  for (const command of [
    "git show HEAD:.nightowl/reviewconfig.json",
    "git show HEAD:",
    "git show HEAD:/workspace/repo/.nightowl/review/previous/index.md",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc...c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- /workspace/repo/.nightowl/review/previous/index.md",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc...c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- :/",
    "git grep token HEAD -- :/",
    "git grep token c1d76cc53b8ded1562c6f1064fb66f582841bd39",
    "git show AAAAAAA:src/app.ts",
    "find .. -maxdepth 1 -type f"
  ]) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }

  for (const command of [
    "git show HEAD:src/app.ts",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc...c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src/app.ts",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- src/app.ts",
    "git diff 6e199e57ec5e101ba9bd0347a37e9508a9b15bcc...c1d76cc53b8ded1562c6f1064fb66f582841bd39 -- .",
    "git grep token HEAD -- .",
    "find src -maxdepth 1 -type f",
    "grep -R token src",
    "ls -a src",
    "ls -la /tmp/nightowl-source-snapshot/src",
    "rg --hidden token src",
    "sed -n '1,10p' src/seed.ts"
  ]) {
    assert.equal(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      undefined,
      command
    );
  }
});

test("tool policy shell policy allows source root inspection but denies .nightowl path targets in snapshot mode", () => {
  for (const command of [
    "cat .nightowl/reviewconfig.json",
    "find .nightowl -type f",
    "ls .nightowl"
  ]) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }

  for (const command of [
    "find . -type f",
    "find -type f",
    "grep -R token .",
    "grep -R token",
    "rg --hidden token .",
    "rg --hidden token",
    "rg -uu token .",
    "ls -a .",
    "ls -A"
  ]) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }

  for (const command of [
    "find src -type f",
    "grep -R token src",
    "rg --hidden token src",
    "ls -a src"
  ]) {
    assert.equal(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      undefined,
      command
    );
  }
});

test("tool policy shell policy denies snapshot ripgrep preprocess hooks", () => {
  for (const command of [
    "rg --pre=tools/pre.sh token src/seed.ts",
    "rg --pre tools/pre.sh token src/seed.ts"
  ]) {
    assert.deepEqual(
      evaluateReadonlyShellCommand(command, SNAPSHOT_PROFILE),
      {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      },
      command
    );
  }

  assert.equal(
    evaluateReadonlyShellCommand(
      "rg --pre=tools/pre.sh token src/app.ts",
      {
        repoRoot: "/workspace/repo",
        reviewOutputRoot: "/workspace/repo/.nightowl/review"
      }
    ),
    undefined
  );
});

test("tool policy shell policy keeps snapshot-only Git restrictions out of explicit same-root profiles", () => {
  const sameRootProfile = {
    repoRoot: "/workspace/repo",
    reviewOutputRoot: "/workspace/repo/.nightowl/review"
  };

  for (const command of [
    "git diff main...feature-branch --name-status",
    "git merge-base main feature-branch",
    "git rev-parse origin/main"
  ]) {
    assert.equal(
      evaluateReadonlyShellCommand(command, sameRootProfile),
      undefined,
      command
    );
  }
});
