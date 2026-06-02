import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_SHEBANG = "#!/usr/bin/env node";

const distRoot = path.join(repoRoot, "dist");
const buildConfigPath = path.join(repoRoot, "tsconfig.build.json");
const builtCliPath = path.join(distRoot, "bin", "review.js");
const tscCliPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

rmSync(distRoot, { force: true, recursive: true });

if (!existsSync(tscCliPath)) {
  throw new Error(
    "TypeScript compiler not found at node_modules/typescript/bin/tsc. Run npm install before npm run build."
  );
}

execFileSync(process.execPath, [tscCliPath, "-p", buildConfigPath], {
  cwd: repoRoot,
  stdio: "inherit"
});

if (!existsSync(builtCliPath)) {
  throw new Error(
    `Build completed without the expected CLI artifact at ${builtCliPath}.`
  );
}

const firstLine = readFileSync(builtCliPath, "utf8").split("\n", 1)[0];

if (firstLine !== CLI_SHEBANG) {
  throw new Error(
    `Built CLI artifact at ${builtCliPath} is missing the expected shebang ${CLI_SHEBANG}.`
  );
}

chmodSync(builtCliPath, 0o755);
