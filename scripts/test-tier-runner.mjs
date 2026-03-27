import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const VALID_TIERS = new Set(["unit", "integration", "e2e"]);

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFilePath), "..");
const manifestPath = path.join(repoRoot, "test", "test-tier-manifest.json");

const tier = process.argv[2];

if (!VALID_TIERS.has(tier)) {
  console.error(
    "Usage: node ./scripts/test-tier-runner.mjs <unit|integration|e2e>"
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const files = manifest[tier];

if (!Array.isArray(files)) {
  console.error(`Tier "${tier}" is missing or invalid in ${manifestPath}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`Tier "${tier}" has no test files configured.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", ...files],
  {
    cwd: repoRoot,
    stdio: "inherit"
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
