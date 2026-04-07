import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, "..");
const distRoot = path.join(repoRoot, "dist");
const buildConfigPath = path.join(repoRoot, "tsconfig.build.json");
const builtCliPath = path.join(distRoot, "bin", "review.js");
const tscCliPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
const CLI_SHEBANG = "#!/usr/bin/env node";

cleanDistOutput();
runTypeScriptBuild();
assertBuiltCliArtifact();
chmodSync(builtCliPath, 0o755);

function cleanDistOutput() {
  rmSync(distRoot, { force: true, recursive: true });
}

function runTypeScriptBuild() {
  if (!existsSync(tscCliPath)) {
    throw new Error(
      "TypeScript compiler not found at node_modules/typescript/bin/tsc. Run npm install before npm run build."
    );
  }

  execFileSync(process.execPath, [tscCliPath, "-p", buildConfigPath], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

function assertBuiltCliArtifact() {
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
