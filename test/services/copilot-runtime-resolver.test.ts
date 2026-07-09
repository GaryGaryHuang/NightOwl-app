import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCopilotCliPath
} from "../../src/services/copilot-runtime-resolver.ts";

function createPackageResolver(packages: Record<string, string>): (specifier: string) => string {
  return (specifier) => {
    const resolved = packages[specifier];
    if (!resolved) {
      throw new Error(`Cannot find package ${specifier}`);
    }

    return resolved;
  };
}

test("resolveCopilotCliPath respects COPILOT_CLI_PATH before package resolution", () => {
  const cliPath = resolveCopilotCliPath({
    env: {
      COPILOT_CLI_PATH: "/custom/copilot"
    },
    platform: "darwin",
    arch: "arm64",
    resolvePackage() {
      throw new Error("package resolution should not be attempted");
    }
  });

  assert.equal(cliPath, "/custom/copilot");
});

test("resolveCopilotCliPath resolves the native macOS arm64 runtime package", () => {
  const cliPath = resolveCopilotCliPath({
    env: {},
    platform: "darwin",
    arch: "arm64",
    resolvePackage: createPackageResolver({
      "@github/copilot-darwin-arm64": "file:///nightowl/node_modules/@github/copilot-darwin-arm64/copilot"
    })
  });

  assert.equal(
    cliPath,
    "/nightowl/node_modules/@github/copilot-darwin-arm64/copilot"
  );
});

test("resolveCopilotCliPath falls back between Linux libc runtime packages", () => {
  const cliPath = resolveCopilotCliPath({
    env: {},
    platform: "linux",
    arch: "x64",
    resolvePackage: createPackageResolver({
      "@github/copilot-linuxmusl-x64": "file:///nightowl/node_modules/@github/copilot-linuxmusl-x64/copilot"
    })
  });

  assert.equal(
    cliPath,
    "/nightowl/node_modules/@github/copilot-linuxmusl-x64/copilot"
  );
});

test("resolveCopilotCliPath resolves the native Windows x64 runtime package", () => {
  const cliPath = resolveCopilotCliPath({
    env: {},
    platform: "win32",
    arch: "x64",
    resolvePackage: createPackageResolver({
      "@github/copilot-win32-x64": "file:///C:/nightowl/node_modules/@github/copilot-win32-x64/copilot.exe"
    })
  });

  assert.match(cliPath, /copilot-win32-x64\/copilot\.exe$/u);
});

test("resolveCopilotCliPath reports supported packages when native runtime resolution fails", () => {
  assert.throws(
    () =>
      resolveCopilotCliPath({
        env: {},
        platform: "linux",
        arch: "x64",
        resolvePackage: createPackageResolver({})
      }),
    (error) =>
      error instanceof Error &&
      /Unable to resolve bundled GitHub Copilot runtime for linux\/x64/u.test(
        error.message
      ) &&
      /@github\/copilot-linux-x64/u.test(error.message) &&
      /@github\/copilot-linuxmusl-x64/u.test(error.message) &&
      /COPILOT_CLI_PATH/u.test(error.message)
  );
});

test("resolveCopilotCliPath reports unsupported platforms clearly", () => {
  assert.throws(
    () =>
      resolveCopilotCliPath({
        env: {},
        platform: "freebsd" as NodeJS.Platform,
        arch: "x64",
        resolvePackage: createPackageResolver({})
      }),
    /No bundled GitHub Copilot runtime package is known for freebsd\/x64/u
  );
});
