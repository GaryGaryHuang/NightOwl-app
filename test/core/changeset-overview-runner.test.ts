import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangesetOverviewRunner
} from "../../src/core/changeset-overview-runner.ts";
import type { ReviewSessionProfile } from "../../src/services/review-session-factory.ts";

test("ChangesetOverviewRunner builds Step 0 input from changeset entries and user context", async () => {
  const profiles: ReviewSessionProfile[] = [];
  const prompts: string[] = [];
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        profiles.push(profile);

        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return "## Changeset Overview\n- 調整範圍：feature";
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    model: "gpt-5.4-mini",
    workingDirectory: "/workspace/repo",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    userContext: ["PR-123", "https://example.com/spec"],
    changedFilesList: ["M\tsrc/app.ts", "D\tobsolete.txt"]
  });

  assert.equal(runContext.changesetOverview, "## Changeset Overview\n- 調整範圍：feature");
  assert.deepEqual(runContext.userContext, [
    "PR-123",
    "https://example.com/spec"
  ]);
  assert.equal(profiles[0]?.knowledgeMode, "built-in-context7");
  assert.equal(
    profiles[0]?.systemMessage,
    [
      "You are a senior code reviewer with expertise in correctness verification, contract-boundary analysis, and behavioral-regression detection. You are executing one designated step of the Code Review SOP.",
      "Your task in each invocation is to complete only the current step and produce the exact output required for that step.",
      "Do not exceed the current step's scope, and do not perform or anticipate later steps.",
      "",
      "## Evidence & Traceability",
      "- Ground every conclusion in observable evidence from the diff, source files, or tool results.",
      "- Separate facts from assumptions: annotate inferences with `[假設]`; mark any claim lacking sufficient evidence with `[待確認]`.",
      "- If a tool call fails, returns no relevant result, or the available context is insufficient, mark the affected claim as `[待確認]` rather than fabricating content.",
      "- Do not treat speculation, likely intent, or common practice as established fact unless supported by evidence.",
      "- State what the code observably does, not what you believe the author intended.",
      "",
      "## Context Retrieval",
      "- Retrieve only the minimal context needed to complete the current step reliably.",
      "- Prefer local evidence first: `view`, `grep`, `glob` for file inspection; use `bash` for git operations (`git diff`, `git blame`, `git log`) or when built-in tools cannot fulfill the task.",
      "- Use `web_fetch` and MCP tools only when the current step requires external knowledge verification that local context cannot provide.",
      "- Stop retrieving additional context once it no longer changes the current step's output.",
      "",
      "## Scope Discipline",
      "- Focus only on the task defined by the current step.",
      "- Do not pre-emptively perform bug finding, risk evaluation, validation, or summary work unless the current step explicitly requires it.",
      "- Do not add extra sections, side notes, or recommendations beyond the current step's output contract.",
      "",
      "## Response Format",
      "- Follow the current step's output contract exactly.",
      "- Markdown steps: begin with the designated `##` heading. No preamble or extra sections.",
      "- JSON steps: output one valid JSON object only. No Markdown code fences or explanatory text.",
      "- Make each field specific enough to support the next step's reasoning, but omit unrequested background content.",
      "- Language: 正體中文, except JSON keys explicitly specified in the step contract.",
      "",
      "## Current Step: Changeset Overview",
      "- This is a run-level step. Establish a high-level understanding of the overall changeset before per-file review begins.",
      "- The goal of this step is to produce shared context that will help subsequent per-file review. Focus on scope, cross-file boundaries, observable behavioral changes, and test coverage observations.",
      "- Do not analyze every file in detail. Do not perform bug finding, validation, risk evaluation, or correctness judgment in this step.",
      "- Behavioral changes are business decisions — record them as observations, not conclusions about whether they are correct.",
      "- If changed files have corresponding test file changes, gather the behavioral expectations and boundary conditions those tests reveal as additional context for subsequent steps.",
      "- If <user_context> is provided, incorporate it into your analysis. If it contains URLs or external references, retrieve and incorporate their content only when relevant and needed to understand the changeset, using available tools.",
      "- Begin the response with `## Changeset Overview`."
    ].join("\n")
  );
  assert.equal(
    prompts[0],
    [
      "<changed_files>",
      "M\tsrc/app.ts",
      "D\tobsolete.txt",
      "</changed_files>",
      "",
      "<user_context>",
      "PR-123",
      "https://example.com/spec",
      "</user_context>",
      "",
      "Analyze the changeset across all files in <changed_files> (each line: file status — A: added, M: modified, D: deleted, R: renamed — followed by file path) and produce a high-level overview for subsequent per-file review.",
      "",
      "Use <changed_files> as the primary input. Retrieve additional repo context only when needed to clarify the changeset's scope, cross-file boundaries, behavioral changes, or test coverage observations. If <user_context> is provided, incorporate only the parts that are relevant to understanding the changeset.",
      "",
      "1. Scope: What areas of the codebase are affected? Categorize each changed area using one or more of the following:",
      "   - feature: new capability or behavior",
      "   - bugfix: appears to correct an existing defect",
      "   - refactor: structural change with no intended behavioral change",
      "   - config: configuration, build, or infrastructure change",
      "   - test: test-only addition or modification",
      "   - docs: documentation-only change",
      "2. Cross-file boundaries: Identify dependencies between changed files and key interaction patterns that matter for later file-level review.",
      "3. Behavioral changes: Flag observable changes in runtime behavior (new features, removed features, changed logic flow, API changes) — as observations, not correctness judgments.",
      "4. Test coverage observation: Note which changed files have corresponding test file changes. If test changes exist, extract the behavioral expectations and boundary conditions they reveal as additional context for subsequent steps.",
      "",
      "Keep the overview high-level and selective. Include only information that is likely to improve the accuracy of later per-file review.",
      "",
      "Respond in the following format:",
      "",
      "## Changeset Overview",
      "- 調整範圍：[categorized scope of changes across files]",
      "- 跨檔案邊界：[cross-file dependencies and interaction patterns, or 無跨檔案相依]",
      "- 行為變更：[behavioral changes requiring business context validation, or 無行為變更]",
      "- 測試覆蓋觀察：[which changed files have corresponding test changes and what behavioral context those tests reveal, or 未見對應測試異動]"
    ].join("\n")
  );
});

test("ChangesetOverviewRunner retries once with a fresh session when the first response is blank", async () => {
  const prompts: string[] = [];
  let createCalls = 0;
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait(prompt) {
            prompts.push(prompt);
            return createCalls === 1 ? undefined : "## Changeset Overview\n- 調整範圍：retry";
          }
        };
      }
    }
  });

  const runContext = await runner.run({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    changedFilesList: ["M\tsrc/app.ts"],
    userContext: []
  });

  assert.equal(createCalls, 2);
  assert.equal(runContext.changesetOverview, "## Changeset Overview\n- 調整範圍：retry");
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0] ?? "", /^<user_context>$/mu);
});

test("ChangesetOverviewRunner fails after two empty responses", async () => {
  let createCalls = 0;
  const runner = new ChangesetOverviewRunner({
    reviewSessionFactory: {
      async createSession() {
        createCalls += 1;

        return {
          async sendAndWait() {
            return "   ";
          }
        };
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        model: "gpt-5.4-mini",
        outputBaseDir: "/workspace/repo/packages/app",
        repoRoot: "/workspace/repo",
        changedFilesList: ["M\tsrc/app.ts"],
        userContext: []
      }),
    /changeset overview/i
  );
  assert.equal(createCalls, 2);
});
