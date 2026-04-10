export declare function runTestTierCommand(options?: {
  args?: string[];
  loadManifest?: () => Record<string, string[]>;
  spawn?: (
    command: string,
    args: string[],
    options: { cwd: string; stdio: string }
  ) => { status: number | null; error?: Error };
  execPath?: string;
  cwd?: string;
  logger?: { log(message: string): void; error(message: string): void };
}): number;
