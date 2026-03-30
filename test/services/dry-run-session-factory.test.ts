import assert from "node:assert/strict";
import test from "node:test";

import {
  DryRunReviewSessionFactory,
  DryRunJudgeSessionFactory
} from "../../src/services/dry-run-session-factory.ts";

// ---------------------------------------------------------------------------
// DryRunReviewSessionFactory — per-step stub responses
// ---------------------------------------------------------------------------

function buildProfile(stepLabel: string) {
  return {
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    systemMessage: [
      "You are a senior code reviewer.",
      "",
      `## Current Step: ${stepLabel}`,
      "Do only this step."
    ].join("\n")
  };
}

test("DryRunReviewSessionFactory - Changeset Overview stub starts with ## Changeset Overview", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Changeset Overview"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Changeset Overview"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Overview (Step 1) stub starts with ## Overview", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Overview"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Overview"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Step 1 stub contains six required fields", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Overview"));
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
  const session = await factory.createSession(buildProfile("Dependencies & Boundaries"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Dependencies & Boundaries"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Knowledge & Source of Truth stub starts with correct heading", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Knowledge & Source of Truth"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Knowledge & Source of Truth"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Strategy & What-if Scenarios stub starts with correct heading", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Strategy & What-if Scenarios"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Strategy & What-if Scenarios"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Step 4 stub contains at least 3 W# items", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Strategy & What-if Scenarios"));
  const response = (await session.sendAndWait("prompt")) ?? "";

  const wMatches = response.match(/\bW\d+\b/gu) ?? [];
  assert.ok(
    wMatches.length >= 3,
    `Step 4 stub should have at least 3 W# items, found: ${wMatches.length}`
  );
});

test("DryRunReviewSessionFactory - Validation & Interrogation stub is valid JSON with empty findings", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Validation & Interrogation"));
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
  const session = await factory.createSession(buildProfile("Cognitive Simulation"));
  const response = (await session.sendAndWait("prompt")) ?? "";

  let parsed: unknown;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(response);
  }, `Step 6 stub is not valid JSON: ${response}`);

  assert.deepEqual((parsed as { findings: unknown[] }).findings, []);
});

test("DryRunReviewSessionFactory - Summary stub starts with ## Summary", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Summary"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string");
  assert.ok(response.startsWith("## Summary"), `got: ${response?.slice(0, 80)}`);
});

test("DryRunReviewSessionFactory - Step 7 stub contains three subsections", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Summary"));
  const response = (await session.sendAndWait("prompt")) ?? "";

  assert.ok(response.includes("審查基礎"), "Step 7 stub missing 審查基礎");
  assert.ok(response.includes("行為變更提醒"), "Step 7 stub missing 行為變更提醒");
  assert.ok(response.includes("風險評估"), "Step 7 stub missing 風險評估");
});

test("DryRunReviewSessionFactory - unknown label returns fallback non-empty string", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(buildProfile("Unknown Step XYZ"));
  const response = await session.sendAndWait("prompt");

  assert.ok(typeof response === "string" && response.length > 0, "fallback should return non-empty string");
  assert.ok(response.includes("[dry-run]"), `fallback should contain [dry-run], got: ${response}`);
});

test("DryRunReviewSessionFactory - setAuditWriter() does not throw", () => {
  const factory = new DryRunReviewSessionFactory();
  assert.doesNotThrow(() => {
    factory.setAuditWriter({} as Parameters<typeof factory.setAuditWriter>[0]);
  });
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
