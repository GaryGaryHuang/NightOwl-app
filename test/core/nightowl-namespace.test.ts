import assert from "node:assert/strict";
import test from "node:test";

import {
  isNightOwlNamespacePath,
  nightowlRoot,
  reviewConfigPath,
  reviewIgnorePath,
  reviewOutputRoot
} from "../../src/core/nightowl-namespace.ts";

// --- path helpers ---

test("nightowlRoot returns repo_root/.nightowl", () => {
  assert.equal(nightowlRoot("/workspace/repo"), "/workspace/repo/.nightowl");
});

test("reviewConfigPath returns repo_root/.nightowl/reviewconfig.json", () => {
  assert.equal(
    reviewConfigPath("/workspace/repo"),
    "/workspace/repo/.nightowl/reviewconfig.json"
  );
});

test("reviewIgnorePath returns repo_root/.nightowl/reviewignore", () => {
  assert.equal(
    reviewIgnorePath("/workspace/repo"),
    "/workspace/repo/.nightowl/reviewignore"
  );
});

test("reviewOutputRoot returns repo_root/.nightowl/review", () => {
  assert.equal(
    reviewOutputRoot("/workspace/repo"),
    "/workspace/repo/.nightowl/review"
  );
});

// --- isNightOwlNamespacePath ---

test("isNightOwlNamespacePath returns true for the namespace directory itself", () => {
  assert.equal(isNightOwlNamespacePath(".nightowl"), true);
});

test("isNightOwlNamespacePath returns true for a direct child of the namespace directory", () => {
  assert.equal(isNightOwlNamespacePath(".nightowl/reviewconfig.json"), true);
});

test("isNightOwlNamespacePath returns true for a deeply nested path under the namespace directory", () => {
  assert.equal(
    isNightOwlNamespacePath(".nightowl/review/main_0408/files/src__foo.ts.md"),
    true
  );
});

test("isNightOwlNamespacePath returns false for a source file outside the namespace", () => {
  assert.equal(isNightOwlNamespacePath("src/app.ts"), false);
});

test("isNightOwlNamespacePath returns false for a path that starts with .nightowl but is not under it", () => {
  assert.equal(isNightOwlNamespacePath(".nightowlrc"), false);
});

test("isNightOwlNamespacePath returns false for an empty string", () => {
  assert.equal(isNightOwlNamespacePath(""), false);
});

test("isNightOwlNamespacePath normalizes Windows backslashes before comparison", () => {
  assert.equal(isNightOwlNamespacePath(".nightowl\\reviewconfig.json"), true);
});
