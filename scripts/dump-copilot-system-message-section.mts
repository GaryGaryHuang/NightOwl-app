import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  CopilotClient,
  SYSTEM_MESSAGE_SECTIONS,
  type ProviderConfig,
  type SectionOverride,
  type SystemMessageConfig,
  type SystemMessageSection
} from "@github/copilot-sdk";

import { buildCopilotClientEnvironment } from "../src/services/copilot-client-manager.ts";

export const DEFAULT_SYSTEM_MESSAGE_SECTION = "runtime_instructions" satisfies SystemMessageSection;
const CAPTURE_ONLY_PROVIDER: ProviderConfig = {
  type: "openai",
  wireApi: "responses",
  baseUrl: "http://127.0.0.1:9/v1",
  apiKey: "nightowl-system-message-capture",
  modelId: "gpt-4.1",
  wireModel: "nightowl-system-message-capture",
  maxPromptTokens: 128000,
  maxOutputTokens: 16
};

interface CaptureOptions {
  section: SystemMessageSection;
  timeoutMs: number;
  triggerPrompt: string;
  workingDirectory: string;
}

interface CliOptions extends CaptureOptions {
  format: "json" | "text";
  output?: string;
}

export function buildSectionCaptureSystemMessage(
  section: SystemMessageSection,
  onCapture: (content: string) => void
): SystemMessageConfig {
  const captureOverride: SectionOverride = {
    action: async (currentContent) => {
      onCapture(currentContent);
      return currentContent;
    }
  };

  return {
    mode: "customize",
    sections: {
      [section]: captureOverride
    }
  };
}

export function formatSectionDump(options: {
  content: string;
  format: "json" | "text";
  section: SystemMessageSection;
}): string {
  if (options.format === "json") {
    return `${JSON.stringify({
      section: options.section,
      length: options.content.length,
      content: options.content
    }, null, 2)}\n`;
  }

  return options.content.endsWith("\n")
    ? options.content
    : `${options.content}\n`;
}

async function captureSystemMessageSection(
  options: CaptureOptions
): Promise<string> {
  let capturedContent: string | undefined;
  let session: Awaited<ReturnType<CopilotClient["createSession"]>> | undefined;
  const client = new CopilotClient({
    env: buildCopilotClientEnvironment(),
    useLoggedInUser: true,
    workingDirectory: options.workingDirectory
  });

  await withTimeout(client.start(), options.timeoutMs, "Copilot client startup");

  try {
    session = await withTimeout(
      client.createSession({
        availableTools: [],
        model: CAPTURE_ONLY_PROVIDER.modelId,
        provider: CAPTURE_ONLY_PROVIDER,
        systemMessage: buildSectionCaptureSystemMessage(
          options.section,
          (content) => {
            capturedContent = content;
          }
        ),
        workingDirectory: options.workingDirectory
      }),
      options.timeoutMs,
      "Copilot session creation"
    );

    if (capturedContent === undefined) {
      try {
        await withTimeout(
          session.sendAndWait(options.triggerPrompt, options.timeoutMs),
          options.timeoutMs,
          "Copilot trigger turn"
        );
      } catch (error) {
        if (capturedContent === undefined) {
          throw error;
        }
      }
    }

    if (capturedContent === undefined) {
      throw new Error(
        `Copilot runtime did not provide system message section '${options.section}'.`
      );
    }

    return capturedContent;
  } finally {
    await session?.disconnect();
    await client.stop();
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      format: { type: "string", default: "text" },
      output: { type: "string" },
      section: { type: "string", default: DEFAULT_SYSTEM_MESSAGE_SECTION },
      "timeout-ms": { type: "string", default: "30000" },
      "trigger-prompt": {
        type: "string",
        default: "Do not inspect files or use tools. Reply with OK."
      },
      "working-directory": { type: "string", default: process.cwd() }
    }
  });

  const section = parseSystemMessageSection(parsed.values.section);
  const format = parseFormat(parsed.values.format);
  const timeoutMs = parsePositiveInteger(
    parsed.values["timeout-ms"],
    "--timeout-ms"
  );

  return {
    format,
    section,
    timeoutMs,
    triggerPrompt: parsed.values["trigger-prompt"],
    workingDirectory: parsed.values["working-directory"],
    ...(parsed.values.output === undefined ? {} : { output: parsed.values.output })
  };
}

function parseSystemMessageSection(value: unknown): SystemMessageSection {
  if (
    typeof value === "string" &&
    Object.hasOwn(SYSTEM_MESSAGE_SECTIONS, value)
  ) {
    return value as SystemMessageSection;
  }

  throw new Error(
    `--section must be one of: ${Object.keys(SYSTEM_MESSAGE_SECTIONS).join(", ")}`
  );
}

function parseFormat(value: unknown): "json" | "text" {
  if (value === "json" || value === "text") {
    return value;
  }

  throw new Error("--format must be 'text' or 'json'.");
}

function parsePositiveInteger(value: unknown, flagName: string): number {
  const parsed = typeof value === "string" ? Number(value) : NaN;

  if (Number.isSafeInteger(parsed) && parsed > 0) {
    return parsed;
  }

  throw new Error(`${flagName} must be a positive integer.`);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function main(argv: string[]): Promise<void> {
  const options = parseCliOptions(argv);
  const content = await captureSystemMessageSection(options);
  const output = formatSectionDump({
    content,
    format: options.format,
    section: options.section
  });

  if (options.output) {
    await writeFile(options.output, output);
  } else {
    process.stdout.write(output);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
