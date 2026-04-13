import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReviewSectionKey,
  buildReviewSectionContract,
  getReviewSectionDefinitionsForSlot,
  REVIEW_SECTION_DEFINITIONS,
  type ReviewSectionDefinition
} from "../../src/core/review-section-contract.ts";

function section(
  overrides: Partial<ReviewSectionDefinition> = {}
): ReviewSectionDefinition {
  return {
    key: "overview",
    stepId: "step1-overview",
    renderSlot: "pre-findings",
    order: 1,
    ...overrides
  };
}

test("review section contract declares the current SOP section outputs and render slots explicitly", () => {
  assert.deepEqual(
    getReviewSectionDefinitionsForSlot("pre-findings").map((definition) => ({
      key: definition.key,
      stepId: definition.stepId,
      order: definition.order
    })),
    [
      { key: "overview", stepId: "step1-overview", order: 1 },
      {
        key: "dependencies-boundaries",
        stepId: "step2-dependencies-boundaries",
        order: 2
      },
      {
        key: "knowledge-source-of-truth",
        stepId: "step3-knowledge-source-of-truth",
        order: 3
      },
      {
        key: "strategy-what-if-scenarios",
        stepId: "step4-strategy-what-if-scenarios",
        order: 4
      }
    ]
  );
  assert.deepEqual(
    getReviewSectionDefinitionsForSlot("post-findings").map((definition) => ({
      key: definition.key,
      stepId: definition.stepId,
      order: definition.order
    })),
    [{ key: "summary", stepId: "step7-summary", order: 1 }]
  );
  assert.equal(REVIEW_SECTION_DEFINITIONS.length, 5);
});

test("buildReviewSectionContract rejects invalid section definitions", () => {
  const cases: Array<{
    label: string;
    definitions: ReviewSectionDefinition[];
    expectedMessage: RegExp;
  }> = [
    {
      label: "duplicate section identifier",
      definitions: [
        section(),
        section({ stepId: "step7-summary", renderSlot: "post-findings" })
      ],
      expectedMessage: /duplicate section identifier: overview/u
    },
    {
      label: "duplicate render order within the same slot",
      definitions: [
        section(),
        section({
          key: "dependencies-boundaries",
          stepId: "step2-dependencies-boundaries"
        })
      ],
      expectedMessage: /duplicate render order 1 in slot pre-findings/u
    },
    {
      label: "invalid render slot",
      definitions: [
        section({
          renderSlot: "between-findings" as ReviewSectionDefinition["renderSlot"]
        })
      ],
      expectedMessage: /invalid render slot: between-findings/u
    },
    {
      label: "missing key",
      definitions: [section({ key: "" as ReviewSectionDefinition["key"] })],
      expectedMessage: /missing key/u
    },
    {
      label: "missing stepId",
      definitions: [section({ stepId: "" })],
      expectedMessage: /missing stepId/u
    }
  ];

  for (const testCase of cases) {
    assert.throws(
      () => buildReviewSectionContract(testCase.definitions),
      testCase.expectedMessage,
      testCase.label
    );
  }
});

test("buildReviewSectionContract produces contract.definitions sorted by slot then order, regardless of input order", () => {
  const contract = buildReviewSectionContract([
    section({
      key: "summary",
      stepId: "step7-summary",
      renderSlot: "post-findings",
      order: 1
    }),
    section({
      key: "dependencies-boundaries",
      stepId: "step2",
      renderSlot: "pre-findings",
      order: 2
    }),
    section({ key: "overview", stepId: "step1", order: 1 })
  ]);

  assert.deepEqual(
    contract.definitions.map((definition) => ({
      key: definition.key,
      renderSlot: definition.renderSlot,
      order: definition.order
    })),
    [
      { key: "overview", renderSlot: "pre-findings", order: 1 },
      { key: "dependencies-boundaries", renderSlot: "pre-findings", order: 2 },
      { key: "summary", renderSlot: "post-findings", order: 1 }
    ]
  );
});

test("assertReviewSectionKey accepts declared section keys and rejects undeclared strings", () => {
  for (const key of [
    "overview",
    "summary",
    "dependencies-boundaries"
  ]) {
    assert.doesNotThrow(() => assertReviewSectionKey(key));
  }

  for (const key of ["not-a-declared-section", ""]) {
    assert.throws(
      () => assertReviewSectionKey(key),
      /undeclared section/u,
      key
    );
  }
});
