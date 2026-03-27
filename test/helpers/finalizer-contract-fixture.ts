import assert from "node:assert/strict";

type TextPattern = string | RegExp;

export function assertTextContainsAll(
  text: string,
  patterns: TextPattern[]
): void {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      assert.match(text, new RegExp(escapeRegExp(pattern), "u"));
      continue;
    }

    assert.match(text, pattern);
  }
}

export function assertTextExcludesAll(
  text: string,
  patterns: TextPattern[]
): void {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      assert.doesNotMatch(text, new RegExp(escapeRegExp(pattern), "u"));
      continue;
    }

    assert.doesNotMatch(text, pattern);
  }
}

// Asserts that each pattern appears in `text` after the position where the
// previous one matched — enforcing relative ordering without requiring strict
// adjacency. `searchStart` advances past each match so patterns cannot
// satisfy each other out of order.
export function assertTextContainsInOrder(
  text: string,
  patterns: TextPattern[]
): void {
  let searchStart = 0;

  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      const index = text.indexOf(pattern, searchStart);

      assert.ok(index >= 0, `expected pattern after index ${searchStart}: ${pattern}`);
      searchStart = index + pattern.length;
      continue;
    }

    const flags = pattern.flags.replace(/g|y/gu, "");
    const regex = new RegExp(pattern.source, `${flags}g`);
    const remainingText = text.slice(searchStart);
    const match = regex.exec(remainingText);

    assert.ok(match, `expected pattern after index ${searchStart}: ${String(pattern)}`);
    searchStart += match.index + match[0].length;
  }
}

export function assertBootstrapShape(text: string, filePath: string): void {
  assertTextContainsInOrder(text, [
    `# ${filePath}`,
    `- Source file: \`${filePath}\``
  ]);
}

export function assertFindingsStats(
  text: string,
  counts: { must: number; nice: number }
): void {
  assertTextContainsAll(text, [
    `${counts.must} must-fix issue(s), ${counts.nice} nice-to-have suggestion(s).`
  ]);
}

export function assertFindingsTitlesInOrder(
  text: string,
  findings: Array<{ type: "must" | "nice"; title: string }>
): void {
  assertTextContainsInOrder(
    text,
    findings.map((finding) => `- [${finding.type}] ${finding.title}`)
  );
}

export function assertTraceabilityForms(
  text: string,
  values: string[]
): void {
  assertTextContainsAll(
    text,
    values.map((value) => `- Traceability: ${value}`)
  );
}

export function assertWarningBlock(
  text: string,
  input: { stepId: string; reason: string }
): void {
  assertTextContainsAll(text, [
    "> [!WARNING] Review Interrupted",
    `> 本檔案在執行 ${input.stepId} 時失敗（原因：${input.reason}），後續審查已略過。`
  ]);
}

// Verifies the warning block appears as the last content in the rendered note.
// A skipped file must not have any review sections rendered after the warning.
export function assertWarningBlockAtEnd(
  text: string,
  input: { stepId: string; reason: string }
): void {
  const warningBlock = [
    "> [!WARNING] Review Interrupted",
    `> 本檔案在執行 ${input.stepId} 時失敗（原因：${input.reason}），後續審查已略過。`
  ].join("\n");

  assert.ok(
    text.endsWith(warningBlock),
    "expected warning block to be the final rendered content"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
