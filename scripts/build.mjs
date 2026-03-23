import { stripTypeScriptTypes } from "node:module";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..");
const srcRoot = path.join(repoRoot, "src");
const distRoot = path.join(repoRoot, "dist");

rmSync(distRoot, { force: true, recursive: true });
mkdirSync(distRoot, { recursive: true });

for (const sourcePath of listTypeScriptFiles(srcRoot)) {
  const relativePath = path.relative(srcRoot, sourcePath);
  const outputPath = path.join(
    distRoot,
    relativePath.replace(/\.ts$/u, ".js")
  );
  const outputDir = path.dirname(outputPath);
  const sourceCode = readFileSync(sourcePath, "utf8");
  const transformed = stripTypeScriptTypes(sourceCode, {
    mode: "transform",
    sourceMap: false
  });
  const rewritten = rewriteTypeScriptSpecifiers(transformed);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, rewritten);

  if (relativePath.startsWith(`bin${path.sep}`)) {
    chmodSync(outputPath, 0o755);
  }
}

function listTypeScriptFiles(directoryPath) {
  const entries = readdirSync(directoryPath).sort();
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function rewriteTypeScriptSpecifiers(code) {
  return code
    .replace(
      /((?:import|export)\s.+?\sfrom\s+["'])(\.[^"']+)\.ts(["'])/gsu,
      "$1$2.js$3"
    )
    .replace(/(import\s*\(\s*["'])(\.[^"']+)\.ts(["']\s*\))/gsu, "$1$2.js$3");
}
