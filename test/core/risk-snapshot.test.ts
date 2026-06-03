import assert from "node:assert/strict";
import test from "node:test";

import { buildRiskSnapshot } from "../../src/core/risk-level.ts";
import { createFinding } from "../helpers/completed-run-finalizer-contract-fixture.ts";

test("buildRiskSnapshot returns a valid RiskSnapshot for all risk levels", async (t) => {
  await t.test("must finding → High", () => {
    const snapshot = buildRiskSnapshot([createFinding("must", 10)]);
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.derivedRiskLevel, "High");
    assert.equal(snapshot.mustCount, 1);
    assert.equal(snapshot.niceCount, 0);
    assert.deepEqual(snapshot.acceptedFindingIds, ["must-10"]);
  });

  await t.test("nice-only findings → Low", () => {
    const snapshot = buildRiskSnapshot([createFinding("nice", 95)]);
    assert.equal(snapshot.derivedRiskLevel, "Low");
    assert.equal(snapshot.mustCount, 0);
    assert.equal(snapshot.niceCount, 1);
    assert.deepEqual(snapshot.acceptedFindingIds, ["nice-95"]);
  });

  await t.test("empty findings → None", () => {
    const snapshot = buildRiskSnapshot([]);
    assert.equal(snapshot.derivedRiskLevel, "None");
    assert.equal(snapshot.mustCount, 0);
    assert.equal(snapshot.niceCount, 0);
    assert.deepEqual(snapshot.acceptedFindingIds, []);
  });

  await t.test("undefined findings → None", () => {
    const snapshot = buildRiskSnapshot(undefined);
    assert.equal(snapshot.derivedRiskLevel, "None");
    assert.equal(snapshot.mustCount, 0);
    assert.equal(snapshot.niceCount, 0);
    assert.deepEqual(snapshot.acceptedFindingIds, []);
  });
});

test("buildRiskSnapshot counts mixed finding types correctly", () => {
  const findings = [
    createFinding("must", 96),
    createFinding("nice", 91),
    createFinding("must", 82, { title: "second must" })
  ];
  findings[2] = { ...findings[2], findingId: "must-82-2" };

  const snapshot = buildRiskSnapshot(findings);
  assert.equal(snapshot.mustCount, 2);
  assert.equal(snapshot.niceCount, 1);
  assert.equal(snapshot.acceptedFindingIds.length, 3);
  assert.ok(snapshot.acceptedFindingIds.includes("must-96"));
  assert.ok(snapshot.acceptedFindingIds.includes("nice-91"));
  assert.ok(snapshot.acceptedFindingIds.includes("must-82-2"));
});
