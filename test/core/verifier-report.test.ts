import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  dispositionReasonToTaxonomy,
  VerifierReportBuilder,
  TAXONOMY_CODES,
  type VerifierReportEntry,
  type VerifierTaxonomyCode
} from "../../src/core/verifier-report.ts";

describe("VerifierReportBuilder", () => {
  // --- VR-1: Empty builder ---

  it("VR-1.1 summarize on empty builder returns all-zero counts", () => {
    const builder = new VerifierReportBuilder();
    const summary = builder.summarize();

    assert.equal(summary.total, 0);
    assert.equal(summary.accepted, 0);
    assert.equal(summary.rejected, 0);

    for (const code of TAXONOMY_CODES) {
      assert.equal(summary.byTaxonomy[code], 0, `byTaxonomy.${code} should be 0`);
    }
  });

  it("VR-1.2 getEntries on empty builder returns empty array", () => {
    const builder = new VerifierReportBuilder();
    assert.deepEqual(builder.getEntries(), []);
  });

  // --- VR-2: Single entry ---

  it("VR-2.1 addEntry then getEntries returns the entry", () => {
    const builder = new VerifierReportBuilder();
    const entry: VerifierReportEntry = {
      findingId: "F1",
      taxonomy: "OK",
      outcome: "accepted",
      gate: "acceptance",
      reason: "all checks passed"
    };
    builder.addEntry(entry);

    const entries = builder.getEntries();
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], entry);
  });

  it("VR-2.2 summarize with one accepted OK entry", () => {
    const builder = new VerifierReportBuilder();
    builder.addEntry({
      findingId: "F1",
      taxonomy: "OK",
      outcome: "accepted",
      gate: "acceptance",
      reason: "all checks passed"
    });

    const summary = builder.summarize();
    assert.equal(summary.total, 1);
    assert.equal(summary.accepted, 1);
    assert.equal(summary.rejected, 0);
    assert.equal(summary.byTaxonomy.OK, 1);
    assert.equal(summary.byTaxonomy.ANCHOR, 0);
  });

  // --- VR-3: Mixed entries ---

  it("VR-3.1 summarize with mixed accepted and rejected entries", () => {
    const builder = new VerifierReportBuilder();
    builder.addEntry({ findingId: "F1", taxonomy: "OK", outcome: "accepted", gate: "acceptance", reason: "passed" });
    builder.addEntry({ findingId: "F2", taxonomy: "OK", outcome: "accepted", gate: "acceptance", reason: "passed" });
    builder.addEntry({ findingId: "F3", taxonomy: "ANCHOR", outcome: "rejected", gate: "anchor", reason: "outside changed lines" });

    const summary = builder.summarize();
    assert.equal(summary.total, 3);
    assert.equal(summary.accepted, 2);
    assert.equal(summary.rejected, 1);
    assert.equal(summary.byTaxonomy.OK, 2);
    assert.equal(summary.byTaxonomy.ANCHOR, 1);
  });

  it("VR-3.2 summarize counts all taxonomy codes correctly", () => {
    const builder = new VerifierReportBuilder();
    const codes: VerifierTaxonomyCode[] = [
      "SCHEMA",
      "ANCHOR",
      "EVIDENCE",
      "REACHABILITY",
      "OUT_OF_SCOPE",
      "DUPLICATE",
      "CONTRADICTION",
      "OK"
    ];
    for (const code of codes) {
      builder.addEntry({
        findingId: `F-${code}`,
        taxonomy: code,
        outcome: code === "OK" ? "accepted" : "rejected",
        gate: code === "OK" ? "acceptance" : "schema",
        reason: `test ${code}`
      });
    }

    const summary = builder.summarize();
    assert.equal(summary.total, codes.length);
    assert.equal(summary.accepted, 1);
    assert.equal(summary.rejected, codes.length - 1);

    for (const code of codes) {
      assert.equal(summary.byTaxonomy[code], 1, `byTaxonomy.${code} should be 1`);
    }
  });

  // --- VR-4: Snapshot isolation ---

  it("VR-4.1 getEntries returns a snapshot copy that is not affected by later addEntry", () => {
    const builder = new VerifierReportBuilder();
    builder.addEntry({ findingId: "F1", taxonomy: "OK", outcome: "accepted", gate: "acceptance", reason: "ok" });

    const snapshot = builder.getEntries();
    assert.equal(snapshot.length, 1);

    builder.addEntry({ findingId: "F2", taxonomy: "ANCHOR", outcome: "rejected", gate: "anchor", reason: "bad" });

    assert.equal(snapshot.length, 1, "snapshot should not grow after later addEntry");
    assert.equal(builder.getEntries().length, 2, "new getEntries should include both");
  });

  it("VR-4.2 mutating a returned entry does not affect builder state", () => {
    const builder = new VerifierReportBuilder();
    builder.addEntry({ findingId: "F1", taxonomy: "OK", outcome: "accepted", gate: "acceptance", reason: "ok" });

    const entries = builder.getEntries();
    (entries[0] as { findingId: string }).findingId = "MUTATED";

    const fresh = builder.getEntries();
    assert.equal(fresh[0].findingId, "F1", "builder state should be unaffected by external mutation");
  });

  it("VR-4.3 mutating the original entry after addEntry does not affect builder state", () => {
    const builder = new VerifierReportBuilder();
    const entry: VerifierReportEntry = { findingId: "F1", taxonomy: "OK", outcome: "accepted", gate: "acceptance", reason: "ok" };
    builder.addEntry(entry);

    (entry as { findingId: string }).findingId = "MUTATED";

    const stored = builder.getEntries();
    assert.equal(stored[0].findingId, "F1", "builder state should be unaffected by input mutation");
  });

  it("maps disposition reasons to verifier taxonomy codes", () => {
    assert.deepEqual(
      [
        dispositionReasonToTaxonomy("SUPPORTED"),
        dispositionReasonToTaxonomy("ANCHOR"),
        dispositionReasonToTaxonomy("EVIDENCE"),
        dispositionReasonToTaxonomy("REACHABILITY"),
        dispositionReasonToTaxonomy("OUT_OF_SCOPE"),
        dispositionReasonToTaxonomy("DUPLICATE"),
        dispositionReasonToTaxonomy("CONTRADICTION")
      ],
      [
        "OK",
        "ANCHOR",
        "EVIDENCE",
        "REACHABILITY",
        "OUT_OF_SCOPE",
        "DUPLICATE",
        "CONTRADICTION"
      ]
    );
  });
});
