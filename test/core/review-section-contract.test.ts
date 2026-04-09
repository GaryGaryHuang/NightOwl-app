import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewSectionContract,
  getReviewSectionDefinitionsForSlot,
  REVIEW_SECTION_DEFINITIONS
} from "../../src/core/review-section-contract.ts";

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

test("buildReviewSectionContract rejects duplicate section identifiers", () => {
  assert.throws(
    () =>
      buildReviewSectionContract([
        {
          key: "overview",
          stepId: "step1-overview",
          renderSlot: "pre-findings",
          order: 1
        },
        {
          key: "overview",
          stepId: "step7-summary",
          renderSlot: "post-findings",
          order: 1
        }
      ]),
    /duplicate section identifier: overview/u
  );
});

test("buildReviewSectionContract rejects duplicate render order within the same slot", () => {
  assert.throws(
    () =>
      buildReviewSectionContract([
        {
          key: "overview",
          stepId: "step1-overview",
          renderSlot: "pre-findings",
          order: 1
        },
        {
          key: "dependencies-boundaries",
          stepId: "step2-dependencies-boundaries",
          renderSlot: "pre-findings",
          order: 1
        }
      ]),
    /duplicate render order 1 in slot pre-findings/u
  );
});

test("buildReviewSectionContract rejects invalid render slots deterministically", () => {
  assert.throws(
    () =>
      buildReviewSectionContract([
        {
          key: "overview",
          stepId: "step1-overview",
          renderSlot: "between-findings" as never,
          order: 1
        }
      ]),
    /invalid render slot: between-findings/u
  );
});

test("buildReviewSectionContract rejects missing key and stepId deterministically", () => {
  assert.throws(
    () =>
      buildReviewSectionContract([
        {
          key: "",
          stepId: "step1-overview",
          renderSlot: "pre-findings",
          order: 1
        }
      ]),
    /missing key/u
  );

  assert.throws(
    () =>
      buildReviewSectionContract([
        {
          key: "overview",
          stepId: "",
          renderSlot: "pre-findings",
          order: 1
        }
      ]),
    /missing stepId/u
  );
});

test("buildReviewSectionContract produces contract.definitions sorted by slot then order, regardless of input order", () => {
  // Fixture satisfies both conditions required to make Map insertion order observably differ from sorted result:
  // (a) a post-findings definition appears before pre-findings definitions in the input array
  // (b) pre-findings definitions are provided in non-ascending order (order 2 before order 1)
  const contract = buildReviewSectionContract([
    { key: "summary", stepId: "step7-summary", renderSlot: "post-findings", order: 1 },
    { key: "dependencies-boundaries", stepId: "step2", renderSlot: "pre-findings", order: 2 },
    { key: "overview", stepId: "step1", renderSlot: "pre-findings", order: 1 }
  ]);

  assert.deepEqual(
    contract.definitions.map((definition) => ({ key: definition.key, renderSlot: definition.renderSlot, order: definition.order })),
    [
      { key: "overview", renderSlot: "pre-findings", order: 1 },
      { key: "dependencies-boundaries", renderSlot: "pre-findings", order: 2 },
      { key: "summary", renderSlot: "post-findings", order: 1 }
    ]
  );
});
