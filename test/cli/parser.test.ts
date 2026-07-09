import assert from "node:assert/strict";
import test from "node:test";

import {
  CliUsageError,
  parseReviewCommand
} from "../../src/cli/parser.ts";

test("parseReviewCommand parses run arguments", () => {
  const cases: Array<{
    name: string;
    argv: string[];
    expected: ReturnType<typeof parseReviewCommand>;
  }> = [
    {
      name: "base and head refs",
      argv: ["main", "feature-branch"],
      expected: {
        kind: "run",
        request: {
          baseRef: "main",
          headRef: "feature-branch",
          userContext: [],
          dryRun: false
        }
      }
    },
    {
      name: "repo path and repeated context flags",
      argv: [
        "main",
        "feature-branch",
        "--repo",
        "./demo",
        "--context",
        "PR-123",
        "--context",
        "https://example.com/spec"
      ],
      expected: {
        kind: "run",
        request: {
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./demo",
          userContext: ["PR-123", "https://example.com/spec"],
          dryRun: false
        }
      }
    },
    {
      name: "dry-run flag at the end",
      argv: ["main", "feature-branch", "--dry-run"],
      expected: {
        kind: "run",
        request: {
          baseRef: "main",
          headRef: "feature-branch",
          userContext: [],
          dryRun: true
        }
      }
    },
    {
      name: "dry-run flag before refs",
      argv: ["--dry-run", "main", "feature-branch"],
      expected: {
        kind: "run",
        request: {
          baseRef: "main",
          headRef: "feature-branch",
          userContext: [],
          dryRun: true
        }
      }
    },
    {
      name: "dry-run flag between refs",
      argv: ["main", "--dry-run", "feature-branch"],
      expected: {
        kind: "run",
        request: {
          baseRef: "main",
          headRef: "feature-branch",
          userContext: [],
          dryRun: true
        }
      }
    },
    {
      name: "dry-run combined with repo and context",
      argv: [
        "main",
        "feature-branch",
        "--dry-run",
        "--repo",
        "./my-repo",
        "--context",
        "PR-42"
      ],
      expected: {
        kind: "run",
        request: {
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./my-repo",
          userContext: ["PR-42"],
          dryRun: true
        }
      }
    }
  ];

  for (const { name, argv, expected } of cases) {
    assert.deepEqual(parseReviewCommand(argv), expected, name);
  }
});

test("parseReviewCommand rejects invalid run arguments", () => {
  const cases: Array<{
    name: string;
    argv: string[];
    messagePattern: RegExp;
  }> = [
    {
      name: "missing base ref",
      argv: [],
      messagePattern: /Missing required base_ref/u
    },
    {
      name: "missing head ref",
      argv: ["main"],
      messagePattern: /Missing required head_ref/u
    },
    {
      name: "repo value is missing at end",
      argv: ["main", "head", "--repo"],
      messagePattern: /Missing value for --repo/u
    },
    {
      name: "repo value is another flag",
      argv: ["main", "head", "--repo", "--context", "x"],
      messagePattern: /Missing value for --repo/u
    },
    {
      name: "context value is missing at end",
      argv: ["main", "head", "--context"],
      messagePattern: /Missing value for --context/u
    },
    {
      name: "context value is another flag",
      argv: ["main", "head", "--context", "--repo", "./demo"],
      messagePattern: /Missing value for --context/u
    },
    {
      name: "unknown option",
      argv: ["main", "head", "--bogus"],
      messagePattern: /Unknown option: --bogus/u
    },
    {
      name: "surplus positional input after head ref",
      argv: ["main", "feature-branch", "unexpected"],
      messagePattern: /Unexpected positional input: unexpected/u
    },
    {
      name: "surplus positional input when options are interleaved",
      argv: [
        "main",
        "--dry-run",
        "feature-branch",
        "--context",
        "PR-42",
        "unexpected"
      ],
      messagePattern: /Unexpected positional input: unexpected/u
    }
  ];

  for (const { name, argv, messagePattern } of cases) {
    assert.throws(
      () => parseReviewCommand(argv),
      (error) =>
        error instanceof CliUsageError && messagePattern.test(error.message),
      name
    );
  }
});

test("parseReviewCommand returns check mode", () => {
  const cases: Array<{ name: string; argv: string[] }> = [
    {
      name: "check as the only input",
      argv: ["--check"]
    },
    {
      name: "check takes precedence over refs and dry-run",
      argv: ["main", "feature-branch", "--dry-run", "--check"]
    },
    {
      name: "check takes precedence over malformed repo",
      argv: ["--repo", "--check"]
    },
    {
      name: "check takes precedence over malformed context",
      argv: ["--context", "--check"]
    },
    {
      name: "check takes precedence over unknown options",
      argv: ["--check", "--bogus"]
    },
    {
      name: "check tolerates repeated flags",
      argv: ["--check", "main", "--check"]
    },
    {
      name: "check takes precedence over surplus positional input",
      argv: ["--check", "main", "feature-branch", "unexpected"]
    }
  ];

  for (const { name, argv } of cases) {
    assert.deepEqual(parseReviewCommand(argv), { kind: "check" }, name);
  }
});

test("parseReviewCommand returns auth mode", () => {
  const cases: Array<{
    name: string;
    argv: string[];
    expected: ReturnType<typeof parseReviewCommand>;
  }> = [
    {
      name: "auth login",
      argv: ["auth", "login"],
      expected: {
        kind: "auth",
        action: "login"
      }
    },
    {
      name: "auth status",
      argv: ["auth", "status"],
      expected: {
        kind: "auth",
        action: "status"
      }
    },
    {
      name: "check takes precedence over auth",
      argv: ["auth", "login", "--check"],
      expected: {
        kind: "check"
      }
    }
  ];

  for (const { name, argv, expected } of cases) {
    assert.deepEqual(parseReviewCommand(argv), expected, name);
  }
});

test("parseReviewCommand rejects invalid auth arguments", () => {
  const cases: Array<{
    name: string;
    argv: string[];
    messagePattern: RegExp;
  }> = [
    {
      name: "missing auth action",
      argv: ["auth"],
      messagePattern: /Missing auth command/u
    },
    {
      name: "unknown auth action",
      argv: ["auth", "logout"],
      messagePattern: /Unknown auth command: logout/u
    },
    {
      name: "surplus auth input",
      argv: ["auth", "login", "extra"],
      messagePattern: /Unexpected positional input: extra/u
    }
  ];

  for (const { name, argv, messagePattern } of cases) {
    assert.throws(
      () => parseReviewCommand(argv),
      (error) =>
        error instanceof CliUsageError && messagePattern.test(error.message),
      name
    );
  }
});
