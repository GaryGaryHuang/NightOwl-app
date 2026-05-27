import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SYSTEM_MESSAGE_SECTION,
  buildSectionCaptureSystemMessage,
  formatSectionDump
} from "../../scripts/dump-copilot-system-message-section.mts";

test("buildSectionCaptureSystemMessage captures and preserves the requested section content", async () => {
  let capturedContent: string | undefined;
  const config = buildSectionCaptureSystemMessage(
    DEFAULT_SYSTEM_MESSAGE_SECTION,
    (content) => {
      capturedContent = content;
    }
  );

  assert.equal(config.mode, "customize");
  const override = config.sections?.[DEFAULT_SYSTEM_MESSAGE_SECTION];

  assert.ok(override);
  if (typeof override.action !== "function") {
    throw new Error("expected section override action to be a transform callback");
  }
  const transformed = await override.action("runtime content");

  assert.equal(capturedContent, "runtime content");
  assert.equal(transformed, "runtime content");
});

test("formatSectionDump preserves text output and provides JSON metadata", () => {
  assert.equal(
    formatSectionDump({
      content: "runtime content",
      format: "text",
      section: DEFAULT_SYSTEM_MESSAGE_SECTION
    }),
    "runtime content\n"
  );

  assert.deepEqual(
    JSON.parse(
      formatSectionDump({
        content: "runtime content",
        format: "json",
        section: DEFAULT_SYSTEM_MESSAGE_SECTION
      })
    ),
    {
      section: DEFAULT_SYSTEM_MESSAGE_SECTION,
      length: "runtime content".length,
      content: "runtime content"
    }
  );
});
