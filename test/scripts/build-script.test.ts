import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..", "..");
const nodeModulesSourceDir = path.join(repoRoot, "node_modules");

test("build emits the published CLI artifact with rewritten JavaScript imports", () => {
  const fixture = createBuildFixture();

  try {
    runBuild(fixture);

    const builtCliPath = path.join(fixture.appCopyDir, "dist", "bin", "review.js");
    assert.ok(existsSync(builtCliPath), "dist/bin/review.js should exist after build");

    const builtCliSource = readFileSync(builtCliPath, "utf8");
    assert.match(builtCliSource, /^#!\/usr\/bin\/env node$/mu);
    assert.match(builtCliSource, /from "\.\.\/index\.js"/u);
    assert.equal(
      statSync(builtCliPath).mode & 0o111,
      0o111,
      "dist/bin/review.js should be executable after build"
    );
  } finally {
    fixture.cleanup();
  }
});

test("build removes stale dist artifacts before compiler emit", () => {
  const fixture = createBuildFixture();

  try {
    runBuild(fixture);

    const staleArtifactPath = path.join(
      fixture.appCopyDir,
      "dist",
      "stale-artifact.js"
    );
    writeFileSync(staleArtifactPath, "export const stale = true;\n");
    assert.ok(existsSync(staleArtifactPath), "stale artifact setup should exist");

    runBuild(fixture);
    assert.equal(
      existsSync(staleArtifactPath),
      false,
      "stale dist artifacts should be removed before the next build"
    );
  } finally {
    fixture.cleanup();
  }
});

function runBuild(fixture: { appCopyDir: string }): void {
  const buildResult = spawnSync("npm", ["run", "build"], {
    cwd: fixture.appCopyDir,
    encoding: "utf8"
  });

  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
}

function createBuildFixture(): {
  appCopyDir: string;
  cleanup(): void;
} {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-build-script-"));
  const appCopyDir = path.join(tempDir, "app");

  cpSync(repoRoot, appCopyDir, {
    recursive: true,
    filter(sourcePath) {
      return !(
        sourcePath.includes(`${path.sep}node_modules`) ||
        sourcePath.includes(`${path.sep}.git`) ||
        sourcePath.endsWith(`${path.sep}dist`)
      );
    }
  });

  rmSync(path.join(appCopyDir, "dist"), { force: true, recursive: true });
  cpSync(nodeModulesSourceDir, path.join(appCopyDir, "node_modules"), {
    recursive: true
  });

  return {
    appCopyDir,
    cleanup() {
      rmSync(tempDir, { force: true, recursive: true });
    }
  };
}
