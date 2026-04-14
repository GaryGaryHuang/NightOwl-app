import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..");
const CLI_SHEBANG = "#!/usr/bin/env node";

export function runBuild({
  projectRoot = repoRoot,
  execPath = process.execPath
} = {}) {
  const distRoot = path.join(projectRoot, "dist");
  const buildConfigPath = path.join(projectRoot, "tsconfig.build.json");
  const builtCliPath = path.join(distRoot, "bin", "review.js");
  const tscCliPath = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");

  cleanDistOutput(distRoot);
  runTypeScriptBuild({ tscCliPath, buildConfigPath, projectRoot, execPath });
  assertBuiltCliArtifact(builtCliPath);
  chmodSync(builtCliPath, 0o755);
}

function cleanDistOutput(distRoot) {
  rmSync(distRoot, { force: true, recursive: true });
}

function runTypeScriptBuild({ tscCliPath, buildConfigPath, projectRoot, execPath }) {
  if (!existsSync(tscCliPath)) {
    throw new Error(
      "TypeScript compiler not found at node_modules/typescript/bin/tsc. Run npm install before npm run build."
    );
  }

  execFileSync(execPath, [tscCliPath, "-p", buildConfigPath], {
    cwd: projectRoot,
    stdio: "inherit"
  });
}

function assertBuiltCliArtifact(builtCliPath) {
  if (!existsSync(builtCliPath)) {
    throw new Error(
      `Build completed without the expected CLI artifact at ${builtCliPath}.`
    );
  }

  const firstLine = readFileSync(builtCliPath, "utf8")
    .split("\n", 1)[0];

  if (firstLine !== CLI_SHEBANG) {
    throw new Error(
      `Built CLI artifact at ${builtCliPath} is missing the expected shebang ${CLI_SHEBANG}.`
    );
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectInvocation) {
  runBuild();
}
