import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isAllowedReviewReadPath } from "../../src/core/review-access-guard.ts";

test("isAllowedReviewReadPath enforces the repo-source and review-output read boundary", () => {
  const repoRoot = "/workspace/repo";
  const cases: Array<{
    requestedPath: string;
    expected: boolean;
  }> = [
    {
      requestedPath: "/workspace/repo",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/src/app.ts",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/.nightowl/review",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/.nightowl/review/session1/file.md",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/.nightowl",
      expected: false
    },
    {
      requestedPath: "/workspace/repo/.nightowl/reviewconfig.json",
      expected: false
    },
    {
      requestedPath: "/workspace/repo/.nightowl/reviewignore",
      expected: false
    },
    {
      requestedPath: "/etc/passwd",
      expected: false
    },
    {
      requestedPath: "/workspace/repo-other/src/app.ts",
      expected: false
    }
  ];

  for (const { requestedPath, expected } of cases) {
    assert.equal(isAllowedReviewReadPath(requestedPath, repoRoot), expected);
  }
});

test("isAllowedReviewReadPath throws when given a relative requestedPath", () => {
  assert.throws(
    () => isAllowedReviewReadPath("src/app.ts", "/workspace/repo"),
    /requires absolute paths/u
  );
});

test("isAllowedReviewReadPath throws when given a relative repoRoot", () => {
  assert.throws(
    () => isAllowedReviewReadPath("/workspace/repo/src/app.ts", "workspace/repo"),
    /requires absolute paths/u
  );
});

test("isAllowedReviewReadPath denies repo paths that escape through symlinked source directories", () => {
  const fixture = createReadBoundaryFixture();

  try {
    const escapedPath = path.join(
      fixture.repoRoot,
      "src",
      "external",
      "secret.txt"
    );

    assert.equal(isAllowedReviewReadPath(escapedPath, fixture.repoRoot), false);
  } finally {
    fixture.cleanup();
  }
});

test("isAllowedReviewReadPath denies review paths that escape through symlinked descendants", () => {
  const fixture = createReadBoundaryFixture();

  try {
    const escapedPath = path.join(
      fixture.repoRoot,
      ".nightowl",
      "review",
      "session1",
      "external",
      "secret.txt"
    );

    assert.equal(isAllowedReviewReadPath(escapedPath, fixture.repoRoot), false);
  } finally {
    fixture.cleanup();
  }
});

test("isAllowedReviewReadPath denies a review root that is itself symlinked outside the repo", () => {
  const fixture = createReadBoundaryFixture({ symlinkReviewRoot: true });

  try {
    const escapedPath = path.join(
      fixture.repoRoot,
      ".nightowl",
      "review",
      "session1",
      "secret.txt"
    );

    assert.equal(isAllowedReviewReadPath(escapedPath, fixture.repoRoot), false);
  } finally {
    fixture.cleanup();
  }
});

interface ReadBoundaryFixture {
  repoRoot: string;
  cleanup(): void;
}

function createReadBoundaryFixture(options?: {
  symlinkReviewRoot?: boolean;
}): ReadBoundaryFixture {
  const baseDir = mkdtempSync(
    path.join(tmpdir(), "nightowl-review-access-guard-")
  );
  const repoRoot = path.join(baseDir, "repo");
  const outsideRoot = path.join(baseDir, "outside");

  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  writeFileSync(path.join(outsideRoot, "secret.txt"), "classified\n");

  symlinkSync(
    outsideRoot,
    path.join(repoRoot, "src", "external"),
    symlinkKindForDirectory()
  );

  if (options?.symlinkReviewRoot) {
    mkdirSync(path.join(repoRoot, ".nightowl"), { recursive: true });
    symlinkSync(
      outsideRoot,
      path.join(repoRoot, ".nightowl", "review"),
      symlinkKindForDirectory()
    );
  } else {
    mkdirSync(path.join(repoRoot, ".nightowl", "review", "session1"), {
      recursive: true
    });
    symlinkSync(
      outsideRoot,
      path.join(repoRoot, ".nightowl", "review", "session1", "external"),
      symlinkKindForDirectory()
    );
  }

  return {
    repoRoot,
    cleanup() {
      rmSync(baseDir, { recursive: true, force: true });
    }
  };
}

function symlinkKindForDirectory(): "dir" | "junction" {
  return process.platform === "win32" ? "junction" : "dir";
}
