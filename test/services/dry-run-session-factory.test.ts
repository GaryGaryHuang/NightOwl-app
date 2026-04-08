import assert from "node:assert/strict";
import test from "node:test";

import {
  DryRunReviewSessionFactory,
  DryRunJudgeSessionFactory,
  type DryRunReviewSessionProfile
} from "../../src/services/dry-run-session-factory.ts";
import type { DryRunReviewStepContract } from "../../src/services/dry-run-review-step-contract.ts";

// ---------------------------------------------------------------------------
// DryRunReviewSessionFactory — per-step stub responses
// ---------------------------------------------------------------------------

function buildProfile(
  dryRunStepContract: DryRunReviewStepContract,
  systemMessage = "Completely different system prompt text."
) {
  return {
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    systemMessage,
    dryRunStepContract
  };
}

test("DryRunReviewSessionFactory - Changeset Overview stub starts with ## Changeset Overview", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("changeset-overview"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Changeset Overview"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Overview (Step 1) stub starts with ## Overview", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("overview"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Overview"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Step 1 stub contains six required fields", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("overview"));
  const response = (await session.sendAndWait("prompt")) ?? "";

  const required = [
    "整體理解",
    "行為變更",
    "檔案職責",
    "改動目的",
    "影響範圍",
    "測試覆蓋觀察"
  ];
  for (const field of required) {
    assert.ok(response.includes(field), `Step 1 stub missing field: ${field}`);
  }
});

test("DryRunReviewSessionFactory - Dependencies & Boundaries stub starts with correct heading", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("dependencies-boundaries"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Dependencies & Boundaries"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Knowledge & Source of Truth stub starts with correct heading", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("knowledge-source-of-truth"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Knowledge & Source of Truth"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Strategy & What-if Scenarios stub starts with correct heading", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("strategy-what-if-scenarios"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Strategy & What-if Scenarios"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Step 4 stub contains at least 3 W# items", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("strategy-what-if-scenarios"));
  const response = (await session.sendAndWait("prompt")) ?? "";

  const wMatches = response.match(/\bW\d+\b/gu) ?? [];
  assert.ok(
    wMatches.length >= 3,
    `Step 4 stub should have at least 3 W# items, found: ${wMatches.length}`
  );
});

test("DryRunReviewSessionFactory - Validation & Interrogation stub is valid JSON with empty findings", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("validation-interrogation"));
  const response = (await session.sendAndWait("prompt")) ?? "";

  let parsed: unknown;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(response);
  }, `Step 5 stub is not valid JSON: ${response}`);

  assert.ok(
    typeof parsed === "object" && parsed !== null && "findings" in parsed,
    "Step 5 stub missing 'findings' key"
  );
  assert.deepEqual((parsed as { findings: unknown[] }).findings, []);
});

test("DryRunReviewSessionFactory - Cognitive Simulation stub is valid JSON with empty findings", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("cognitive-simulation"));
  const response = (await session.sendAndWait("prompt")) ?? "";

  let parsed: unknown;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(response);
  }, `Step 6 stub is not valid JSON: ${response}`);

  assert.deepEqual((parsed as { findings: unknown[] }).findings, []);
});

test("DryRunReviewSessionFactory - Summary stub starts with ## Summary", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("summary"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Summary"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Step 7 stub contains three subsections", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("summary"));
  const response = (await session.sendAndWait("prompt")) ?? "";

  assert.ok(response.includes("審查基礎"), "Step 7 stub missing 審查基礎");
  assert.ok(response.includes("行為變更提醒"), "Step 7 stub missing 行為變更提醒");
  assert.ok(response.includes("風險評估"), "Step 7 stub missing 風險評估");
});

test("DryRunReviewSessionFactory - prompt wording changes do not affect stub selection when the explicit contract is unchanged", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(
    buildProfile(
      "overview",
      "No step heading is present here. The contract must drive selection."
    )
  );
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Overview"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - missing contract fails as an identifiable dry-run contract failure", async () => {
  const factory = new DryRunReviewSessionFactory();

  await assert.rejects(
    () =>
      factory.createSession(
        // Type assertion bypasses compile-time check to verify runtime missing-contract detection.
        {
          model: "gpt-5.4-mini",
          outputBaseDir: "/workspace/repo",
          repoRoot: "/workspace/repo",
          systemMessage: "system prompt"
        } as Omit<DryRunReviewSessionProfile, "dryRunStepContract"> as DryRunReviewSessionProfile
      ),
    /dry-run contract failure: missing dryRunStepContract/u
  );
});

test("DryRunReviewSessionFactory - unknown contract fails as an identifiable dry-run contract failure", async () => {
  const factory = new DryRunReviewSessionFactory();

  await assert.rejects(
    () =>
      factory.createSession({
        model: "gpt-5.4-mini",
        outputBaseDir: "/workspace/repo",
        repoRoot: "/workspace/repo",
        systemMessage: "system prompt",
        dryRunStepContract: "unknown-step" as DryRunReviewStepContract
      } as DryRunReviewSessionProfile),
    /dry-run contract failure: unsupported dryRunStepContract 'unknown-step'/u
  );
});

// ---------------------------------------------------------------------------
// DryRunJudgeSessionFactory
// ---------------------------------------------------------------------------

test("DryRunJudgeSessionFactory - sendAndWait() always returns 'Y'", async () => {
  const factory = new DryRunJudgeSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    systemMessage: "judge system"
  });

  const result = await session.sendAndWait("please evaluate");
  assert.equal(result, "Y");
});

test("DryRunJudgeSessionFactory - sendAndWait() returns 'Y' regardless of prompt", async () => {
  const factory = new DryRunJudgeSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    systemMessage: "judge system"
  });

  assert.equal(await session.sendAndWait("N"), "Y");
  assert.equal(await session.sendAndWait(""), "Y");
  assert.equal(await session.sendAndWait("some long prompt"), "Y");
});
