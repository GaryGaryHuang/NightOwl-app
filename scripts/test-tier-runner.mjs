import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  ManifestVerificationError,
  loadVerifiedTestTierManifest
} from "./verify-test-tier-manifest.mjs";

const VALID_TIERS = new Set(["unit", "integration", "e2e"]);

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFilePath), "..");

export function runTestTierCommand({
  args = process.argv.slice(2),
  loadManifest = loadVerifiedTestTierManifest,
  spawn = spawnSync,
  execPath = process.execPath,
  cwd = repoRoot,
  logger = console
} = {}) {
  const tier = args[0];

  if (!VALID_TIERS.has(tier)) {
    logger.error(
      "Usage: node ./scripts/test-tier-runner.mjs <unit|integration|e2e>"
    );
    return 1;
  }

  let manifest;
  try {
    manifest = loadManifest();
  } catch (error) {
    if (error instanceof ManifestVerificationError) {
      return 1;
    }

    throw error;
  }

  const files = manifest[tier];

  if (!Array.isArray(files)) {
    logger.error(`Tier "${tier}" is missing or invalid in test/test-tier-manifest.json`);
    return 1;
  }

  if (files.length === 0) {
    logger.error(`Tier "${tier}" has no test files configured.`);
    return 1;
  }

  const result = spawn(
    execPath,
    ["--test", ...files],
    {
      cwd,
      stdio: "inherit"
    }
  );

  if (result.error) {
    logger.error(result.error);
    return 1;
  }

  return result.status ?? 1;
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectInvocation) {
  process.exit(runTestTierCommand());
}
