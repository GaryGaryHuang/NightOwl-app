import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CANONICAL_TIERS = ["unit", "integration", "e2e"];
const MANIFEST_VERIFICATION_ERROR_MESSAGE = "test-tier-manifest verification failed";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

function isCanonicalManifestPath(entry) {
  if (typeof entry !== "string") {
    return false;
  }

  if (entry.length === 0 || entry.includes("\\")) {
    return false;
  }

  if (
    entry.startsWith("./") ||
    entry.startsWith("../") ||
    entry.startsWith("/")
  ) {
    return false;
  }

  if (!entry.startsWith("test/")) {
    return false;
  }

  return path.posix.normalize(entry) === entry;
}

function loadManifestFromDisk() {
  try {
    return {
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
      schemaViolations: []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      manifest: null,
      schemaViolations: [
        `Manifest could not be parsed as JSON: ${message}`
      ]
    };
  }
}

function validateManifest(manifest) {
  const schemaViolations = [];
  const sortOrderViolations = [];
  const pathFormatViolations = [];

  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      tierLists: Object.fromEntries(CANONICAL_TIERS.map((tier) => [tier, []])),
      schemaViolations: ["Manifest root must be a JSON object."],
      sortOrderViolations,
      pathFormatViolations
    };
  }

  const topLevelKeys = Object.keys(manifest);
  const unexpectedKeys = topLevelKeys.filter((key) => !CANONICAL_TIERS.includes(key));
  const missingKeys = CANONICAL_TIERS.filter((tier) => !topLevelKeys.includes(tier));

  if (unexpectedKeys.length > 0) {
    schemaViolations.push(
      `Unexpected top-level keys: ${unexpectedKeys.join(", ")}. Only ${CANONICAL_TIERS.join(", ")} are allowed.`
    );
  }

  if (missingKeys.length > 0) {
    schemaViolations.push(
      `Missing top-level keys: ${missingKeys.join(", ")}. Manifest must define all canonical tiers.`
    );
  }

  const tierLists = {};

  for (const tier of CANONICAL_TIERS) {
    const value = manifest[tier];

    if (!Array.isArray(value)) {
      tierLists[tier] = [];
      schemaViolations.push(`Tier \"${tier}\" must map to an array.`);
      continue;
    }

    tierLists[tier] = value;

    const sorted = [...value].sort((left, right) => left.localeCompare(right));
    if (value.some((entry, index) => entry !== sorted[index])) {
      sortOrderViolations.push(
        `Tier \"${tier}\" must be sorted lexicographically.`
      );
    }

    for (const entry of value) {
      if (!isCanonicalManifestPath(entry)) {
        pathFormatViolations.push(
          `${String(entry)} (expected repo-root-relative POSIX path under test/ with no leading ./)`
        );
      }
    }
  }

  return {
    tierLists,
    schemaViolations,
    sortOrderViolations,
    pathFormatViolations
  };
}

function printViolations(title, entries, logger) {
  if (entries.length === 0) {
    return;
  }

  logger.error(`\n  ${title}:`);
  for (const entry of entries) {
    logger.error(`    ${entry}`);
  }
}

export class ManifestVerificationError extends Error {
  constructor(message = MANIFEST_VERIFICATION_ERROR_MESSAGE) {
    super(message);
    this.name = "ManifestVerificationError";
  }
}

export function evaluateTestTierManifest({ manifest, parseViolations = [], diskFiles }) {
  const {
    tierLists,
    schemaViolations,
    sortOrderViolations,
    pathFormatViolations
  } = validateManifest(manifest);
  const allSchemaViolations = [...parseViolations, ...schemaViolations];
  const allManifestEntries = CANONICAL_TIERS.flatMap((tier) => tierLists[tier]);

  const manifestSet = new Set(allManifestEntries);
  const duplicates = [];
  const seen = new Set();
  for (const entry of allManifestEntries) {
    if (seen.has(entry)) {
      duplicates.push(entry);
    }
    seen.add(entry);
  }

  const diskFileSet = new Set(diskFiles);
  const canCheckDiskParity =
    allSchemaViolations.length === 0 &&
    pathFormatViolations.length === 0;
  const missingFromManifest = canCheckDiskParity
    ? [...diskFileSet]
      .filter((f) => !manifestSet.has(f))
      .sort((left, right) => left.localeCompare(right))
    : [];
  const staleInManifest = canCheckDiskParity
    ? [...manifestSet]
      .filter((f) => !diskFileSet.has(f))
      .sort((left, right) => left.localeCompare(right))
    : [];
  const hasErrors =
    allSchemaViolations.length > 0 ||
    sortOrderViolations.length > 0 ||
    pathFormatViolations.length > 0 ||
    duplicates.length > 0 ||
    missingFromManifest.length > 0 ||
    staleInManifest.length > 0;

  return {
    tierLists,
    allSchemaViolations,
    sortOrderViolations,
    pathFormatViolations,
    duplicates,
    missingFromManifest,
    staleInManifest,
    hasErrors,
    diskFileCount: diskFileSet.size
  };
}

function reportManifestVerification(result, logger) {
  logger.error(`✗ ${MANIFEST_VERIFICATION_ERROR_MESSAGE}:`);
  printViolations("Manifest schema violations", result.allSchemaViolations, logger);
  printViolations("Manifest sort-order violations", result.sortOrderViolations, logger);
  printViolations("Manifest path-format violations", result.pathFormatViolations, logger);
  printViolations("Files listed in more than one tier", result.duplicates, logger);
  printViolations(
    "Test files on disk but not in manifest (assign to unit/integration/e2e)",
    result.missingFromManifest,
    logger
  );
  printViolations(
    "Manifest entries with no corresponding file on disk",
    result.staleInManifest,
    logger
  );
}

export function loadVerifiedTestTierManifest({ logger = console } = {}) {
  const { manifest, schemaViolations: parseViolations } = loadManifestFromDisk();
  const result = evaluateTestTierManifest({
    manifest,
    parseViolations,
    diskFiles: discoverTestFiles(testDir)
  });

  if (result.hasErrors) {
    reportManifestVerification(result, logger);
    throw new ManifestVerificationError();
  }

  logger.log(
    `✔ test-tier-manifest verified: ${result.diskFileCount} test files, canonical schema, all assigned to exactly one tier.`
  );

  return result.tierLists;
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectInvocation) {
  try {
    loadVerifiedTestTierManifest();
  } catch (error) {
    if (error instanceof ManifestVerificationError) {
      process.exit(1);
    }

    throw error;
  }
}
