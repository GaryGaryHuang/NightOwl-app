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

test("isAllowedReviewReadPath allows repo source and .nightowl non-review paths while denying review artifacts", () => {
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
      expected: false
    },
    {
      requestedPath: "/workspace/repo/.nightowl/review/session1/file.md",
      expected: false
    },
    {
      requestedPath: "/workspace/repo/.nightowl",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/.nightowl/reviewconfig.json",
      expected: true
    },
    {
      requestedPath: "/workspace/repo/.nightowl/reviewignore",
      expected: true
    },
    {
      requestedPath:
        "/workspace/repo/.nightowl/copilot-session-state/session1/plan.md",
      expected: true
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

test("isAllowedReviewReadPath supports snapshot source roots without allowing original review output artifacts", () => {
  const sourceRoot = "/tmp/nightowl-source-snapshot";
  const cases: Array<{
    requestedPath: string;
    expected: boolean;
  }> = [
    {
      requestedPath: "/tmp/nightowl-source-snapshot/src/app.ts",
      expected: true
    },
    {
      requestedPath: "/tmp/nightowl-source-snapshot/.nightowl/reviewconfig.json",
      expected: true
    },
    {
      requestedPath: "/tmp/nightowl-source-snapshot/.nightowl/reviewignore",
      expected: true
    },
    {
      requestedPath: "/tmp/nightowl-source-snapshot/.nightowl/review",
      expected: false
    },
    {
      requestedPath:
        "/tmp/nightowl-source-snapshot/.nightowl/review/current/index.md",
      expected: false
    },
    {
      requestedPath: "/workspace/repo/.nightowl/review/current/index.md",
      expected: false
    },
    {
      requestedPath: "/workspace/repo/.nightowl/review/previous/files/app.md",
      expected: false
    },
    {
      requestedPath: "/workspace/repo/src/app.ts",
      expected: false
    }
  ];

  for (const { requestedPath, expected } of cases) {
    assert.equal(
      isAllowedReviewReadPath(requestedPath, { repoRoot: sourceRoot }),
      expected
    );
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

test("isAllowedReviewReadPath denies symlink escapes hidden behind parent traversal", () => {
  const fixture = createReadBoundaryFixture({ symlinkReviewRoot: true });

  try {
    const sourceSymlinkParentTraversal = [
      fixture.repoRoot,
      "src",
      "external",
      "..",
      "secret.txt"
    ].join(path.sep);
    const reviewSymlinkParentTraversal = [
      fixture.repoRoot,
      ".nightowl",
      "review",
      "..",
      "secret.txt"
    ].join(path.sep);

    assert.equal(
      isAllowedReviewReadPath(sourceSymlinkParentTraversal, fixture.repoRoot),
      false
    );
    assert.equal(
      isAllowedReviewReadPath(reviewSymlinkParentTraversal, fixture.repoRoot),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("isAllowedReviewReadPath allows alternate canonical spellings of the active repo root", () => {
  const fixture = createReadBoundaryFixture({ createRepoAlias: true });

  try {
    assert.equal(
      isAllowedReviewReadPath(
        path.join(fixture.repoAlias!, "src", "app.ts"),
        fixture.repoRoot
      ),
      true
    );
    assert.equal(
      isAllowedReviewReadPath(
        path.join(
          fixture.repoAlias!,
          ".nightowl",
          "review",
          "session1",
          "index.md"
        ),
        fixture.repoRoot
      ),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("isAllowedReviewReadPath denies review artifact paths even when descendants are symlinked", () => {
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

test("isAllowedReviewReadPath denies non-review .nightowl symlinks that resolve into review artifacts", () => {
  const fixture = createReadBoundaryFixture();

  try {
    const escapedPath = path.join(
      fixture.repoRoot,
      ".nightowl",
      "cache",
      "review-link",
      "session1",
      "index.md"
    );

    assert.equal(isAllowedReviewReadPath(escapedPath, fixture.repoRoot), false);
  } finally {
    fixture.cleanup();
  }
});

test("isAllowedReviewReadPath allows non-review .nightowl paths that remain inside the repo", () => {
  const fixture = createReadBoundaryFixture();

  try {
    const allowedPath = path.join(
      fixture.repoRoot,
      ".nightowl",
      "cache",
      "state.json"
    );

    assert.equal(isAllowedReviewReadPath(allowedPath, fixture.repoRoot), true);
  } finally {
    fixture.cleanup();
  }
});

test("isAllowedReviewReadPath denies a review root even when it is symlinked outside the repo", () => {
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
  repoAlias?: string;
  repoRoot: string;
  cleanup(): void;
}

function createReadBoundaryFixture(options?: {
  createRepoAlias?: boolean;
  symlinkReviewRoot?: boolean;
}): ReadBoundaryFixture {
  const baseDir = mkdtempSync(
    path.join(tmpdir(), "nightowl-review-access-guard-")
  );
  const repoRoot = path.join(baseDir, "repo");
  const repoAlias = path.join(baseDir, "repo-alias");
  const outsideRoot = path.join(baseDir, "outside");

  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  writeFileSync(path.join(baseDir, "secret.txt"), "parent secret\n");
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
    writeFileSync(
      path.join(repoRoot, ".nightowl", "review", "session1", "index.md"),
      "previous review\n"
    );
    symlinkSync(
      outsideRoot,
      path.join(repoRoot, ".nightowl", "review", "session1", "external"),
      symlinkKindForDirectory()
    );
  }

  mkdirSync(path.join(repoRoot, ".nightowl", "cache"), { recursive: true });
  writeFileSync(path.join(repoRoot, ".nightowl", "cache", "state.json"), "{}\n");

  if (!options?.symlinkReviewRoot) {
    symlinkSync(
      path.join(repoRoot, ".nightowl", "review"),
      path.join(repoRoot, ".nightowl", "cache", "review-link"),
      symlinkKindForDirectory()
    );
  }

  if (options?.createRepoAlias === true) {
    symlinkSync(repoRoot, repoAlias, symlinkKindForDirectory());
  }

  return {
    ...(options?.createRepoAlias === true ? { repoAlias } : {}),
    repoRoot,
    cleanup() {
      rmSync(baseDir, { recursive: true, force: true });
    }
  };
}

function symlinkKindForDirectory(): "dir" | "junction" {
  return process.platform === "win32" ? "junction" : "dir";
}
