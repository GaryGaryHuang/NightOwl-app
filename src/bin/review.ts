#!/usr/bin/env node

// Keep the binary wrapper minimal; the CLI logic lives in src/index.ts.
import { runCli } from "../index.ts";

const exitCode = await runCli(process.argv.slice(2));

if (typeof exitCode === "number") {
  process.exitCode = exitCode;
}
