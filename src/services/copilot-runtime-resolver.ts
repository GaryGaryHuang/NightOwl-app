import { fileURLToPath } from "node:url";

export interface CopilotRuntimeResolverOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  resolvePackage?: (specifier: string) => string;
}

const RUNTIME_PACKAGES: Partial<
  Record<NodeJS.Platform, Partial<Record<NodeJS.Architecture, readonly string[]>>>
> = {
  darwin: {
    arm64: ["@github/copilot-darwin-arm64"],
    x64: ["@github/copilot-darwin-x64"]
  },
  linux: {
    arm64: ["@github/copilot-linux-arm64", "@github/copilot-linuxmusl-arm64"],
    x64: ["@github/copilot-linux-x64", "@github/copilot-linuxmusl-x64"]
  },
  win32: {
    arm64: ["@github/copilot-win32-arm64"],
    x64: ["@github/copilot-win32-x64"]
  }
};

export function resolveCopilotCliPath(
  options: CopilotRuntimeResolverOptions = {}
): string {
  const env = options.env ?? process.env;
  if (env.COPILOT_CLI_PATH) {
    return env.COPILOT_CLI_PATH;
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const candidatePackages = RUNTIME_PACKAGES[platform]?.[arch] ?? [];

  if (candidatePackages.length === 0) {
    throw new Error(
      `No bundled GitHub Copilot runtime package is known for ${platform}/${arch}. ` +
        "Set COPILOT_CLI_PATH to a Copilot runtime executable."
    );
  }

  const resolvePackage =
    options.resolvePackage ?? ((specifier: string) => import.meta.resolve(specifier));
  const resolutionErrors: string[] = [];

  for (const packageName of candidatePackages) {
    try {
      return filePathFromResolvedPackage(resolvePackage(packageName));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolutionErrors.push(`${packageName}: ${message}`);
    }
  }

  throw new Error(
    `Unable to resolve bundled GitHub Copilot runtime for ${platform}/${arch}. ` +
      `Tried ${candidatePackages.join(", ")}. ` +
      "Reinstall @garyhuangdev/nightowl so npm installs the matching optional dependency, " +
      "or set COPILOT_CLI_PATH to a Copilot runtime executable. " +
      `Resolution errors: ${resolutionErrors.join("; ")}`
  );
}

function filePathFromResolvedPackage(resolvedPackage: string): string {
  try {
    const resolvedUrl = new URL(resolvedPackage);
    if (resolvedUrl.protocol === "file:") {
      return fileURLToPath(resolvedUrl);
    }
  } catch {
    return resolvedPackage;
  }

  return resolvedPackage;
}
