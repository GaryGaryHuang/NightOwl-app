import assert from "node:assert/strict";
import test from "node:test";

import { VerifierReportFinalizer } from "../../../src/core/finalizers/verifier-report-finalizer.ts";
import {
  createPlannedNotes,
  createSkippedFile,
  createSuccessfulFile,
  createVerifierReportArtifactEntry
} from "../../helpers/completed-run-finalizer-contract-fixture.ts";

test("VerifierReportFinalizer renders the exact JSONL contract for mixed-result runs", () => {
  const rendered = new VerifierReportFinalizer().render({
    plannedNotes: createPlannedNotes([
      ["src/a.ts", "/workspace/.nightowl/review/feature/files/src__a.ts.md"],
      ["src/b.ts", "/workspace/.nightowl/review/feature/files/src__b.ts.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("src/a.ts", [], [
        createVerifierReportArtifactEntry({
          filePath: "src/a.ts",
          stepId: "step5-validation-interrogation",
          findingId: "F1",
          taxonomy: "OK",
          outcome: "accepted",
          gate: "schema",
          reason: "passed schema and anchor validation"
        })
      ])
    ],
    skippedFiles: [
      createSkippedFile("src/b.ts", "step6-cognitive-simulation", "review timeout", [
        createVerifierReportArtifactEntry({
          filePath: "src/b.ts",
          stepId: "step5-validation-interrogation",
          findingId: "F2",
          taxonomy: "EVIDENCE",
          outcome: "rejected",
          gate: "acceptance",
          reason: "uncertaintyStatus is 'tentative'"
        })
      ])
    ]
  });

  const lines = rendered.split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(
    Object.keys(JSON.parse(lines[0]!)),
    ["filePath", "stepId", "findingId", "taxonomy", "outcome", "gate", "reason"]
  );
  assert.deepEqual(JSON.parse(lines[1]!), {
    filePath: "src/b.ts",
    stepId: "step5-validation-interrogation",
    findingId: "F2",
    taxonomy: "EVIDENCE",
    outcome: "rejected",
    gate: "acceptance",
    reason: "uncertaintyStatus is 'tentative'"
  });
});

test("VerifierReportFinalizer preserves planned file order and per-file step order", () => {
  const rendered = new VerifierReportFinalizer().render({
    plannedNotes: createPlannedNotes([
      ["src/a.ts", "/workspace/.nightowl/review/feature/files/src__a.ts.md"],
      ["src/b.ts", "/workspace/.nightowl/review/feature/files/src__b.ts.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("src/b.ts", [], [
        createVerifierReportArtifactEntry({ filePath: "src/b.ts", stepId: "step6-cognitive-simulation", findingId: "FB" })
      ]),
      createSuccessfulFile("src/a.ts", [], [
        createVerifierReportArtifactEntry({ filePath: "src/a.ts", stepId: "step5-validation-interrogation", findingId: "FA1" }),
        createVerifierReportArtifactEntry({ filePath: "src/a.ts", stepId: "step6-cognitive-simulation", findingId: "FA2" })
      ])
    ],
    skippedFiles: []
  });

  assert.deepEqual(
    rendered.split("\n").map((line) => JSON.parse(line).findingId),
    ["FA1", "FA2", "FB"]
  );
});

test("VerifierReportFinalizer persists retired disposition audit fields", () => {
  const rendered = new VerifierReportFinalizer().render({
    plannedNotes: createPlannedNotes([
      ["src/a.ts", "/workspace/.nightowl/review/feature/files/src__a.ts.md"]
    ]),
    successfulFiles: [
      createSuccessfulFile("src/a.ts", [], [
        createVerifierReportArtifactEntry({
          filePath: "src/a.ts",
          stepId: "step6-cognitive-simulation",
          findingId: "F1",
          taxonomy: "REACHABILITY",
          outcome: "rejected",
          gate: "disposition",
          reason: "candidate retired: REACHABILITY - path is not reachable",
          dispositionStatus: "retired",
          dispositionReason: "REACHABILITY",
          dispositionExplanation: "path is not reachable"
        })
      ])
    ],
    skippedFiles: []
  });

  assert.deepEqual(JSON.parse(rendered), {
    filePath: "src/a.ts",
    stepId: "step6-cognitive-simulation",
    findingId: "F1",
    taxonomy: "REACHABILITY",
    outcome: "rejected",
    gate: "disposition",
    reason: "candidate retired: REACHABILITY - path is not reachable",
    dispositionStatus: "retired",
    dispositionReason: "REACHABILITY",
    dispositionExplanation: "path is not reachable"
  });
});

test("VerifierReportFinalizer renders empty content for zero-file runs", () => {
  const rendered = new VerifierReportFinalizer().render({
    plannedNotes: [],
    successfulFiles: [],
    skippedFiles: []
  });

  assert.equal(rendered, "");
});
