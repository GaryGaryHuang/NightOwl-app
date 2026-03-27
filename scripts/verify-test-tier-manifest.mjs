import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFilePath), "..");
const manifestPath = path.join(repoRoot, "test", "test-tier-manifest.json");
const testDir = path.join(repoRoot, "test");
const helpersDir = path.join(repoRoot, "test", "helpers");

function discoverTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (fullPath === helpersDir) continue;
      results.push(...discoverTestFiles(fullPath));
    } else if (entry.endsWith(".test.ts")) {
      results.push(path.relative(repoRoot, fullPath).replaceAll(path.sep, "/"));
    }
  }
  return results;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const unit = manifest.unit ?? [];
const integration = manifest.integration ?? [];
const e2e = manifest.e2e ?? [];
const allManifestEntries = [...unit, ...integration, ...e2e];

// Step 1: detect intra-manifest duplicates
const manifestSet = new Set(allManifestEntries);
const duplicates = [];
if (allManifestEntries.length !== manifestSet.size) {
  const seen = new Set();
  for (const entry of allManifestEntries) {
    if (seen.has(entry)) {
      duplicates.push(entry);
    }
    seen.add(entry);
  }
}

// Step 2: symmetric difference between disk and manifest
const diskFiles = new Set(discoverTestFiles(testDir));
const missingFromManifest = [...diskFiles].filter((f) => !manifestSet.has(f));
const staleInManifest = [...manifestSet].filter((f) => !diskFiles.has(f));

const hasErrors = duplicates.length > 0 || missingFromManifest.length > 0 || staleInManifest.length > 0;

if (!hasErrors) {
  console.log(`✔ test-tier-manifest verified: ${diskFiles.size} test files, all assigned to exactly one tier.`);
  process.exit(0);
}

console.error("✗ test-tier-manifest verification failed:");

if (duplicates.length > 0) {
  console.error("\n  Files listed in more than one tier:");
  for (const f of duplicates) {
    console.error(`    ${f}`);
  }
}

if (missingFromManifest.length > 0) {
  console.error("\n  Test files on disk but not in manifest (assign to unit/integration/e2e):");
  for (const f of missingFromManifest) {
    console.error(`    ${f}`);
  }
}

if (staleInManifest.length > 0) {
  console.error("\n  Manifest entries with no corresponding file on disk:");
  for (const f of staleInManifest) {
    console.error(`    ${f}`);
  }
}

process.exit(1);
