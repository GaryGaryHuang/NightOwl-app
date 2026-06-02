type ScriptLogger = {
  log(message: string): void;
  error(message: string): void;
};

type TestTierManifest = {
  unit: string[];
  integration: string[];
  e2e: string[];
};

export declare function runTestTierCommand(options?: {
  args?: string[];
  loadManifest?: () => TestTierManifest;
  spawn?: (
    command: string,
    args: string[],
    options: { cwd: string; stdio: "inherit" }
  ) => { status: number | null; error?: Error };
  execPath?: string;
  cwd?: string;
  logger?: ScriptLogger;
}): number;
