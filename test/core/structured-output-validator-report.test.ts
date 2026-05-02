import assert from "node:assert/strict";
import test from "node:test";

import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "../../src/core/structured-output-validator.ts";
import {
  DEFAULT_DIFF,
  finding,
  lineRangeTraceability,
  payload
} from "../helpers/structured-output-validator-fixture.ts";

function captureStructuredValidationReportError(
  callback: () => void
): StructuredValidationReportError {
  try {
    callback();
  } catch (error) {
    assert.ok(error instanceof StructuredValidationReportError);
    return error;
  }

  assert.fail("Expected StructuredValidationReportError");
}

test("validateWithReport returns payload and per-finding schema-pass report entries", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({ traceability: lineRangeTraceability(21, 22) });
  const result = validator.validateWithReport({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].findingId, "F1");
  assert.equal(result.report[0].taxonomy, "OK");
  assert.equal(result.report[0].outcome, "accepted");
  assert.equal(result.report[0].gate, "schema");
});

test("validateWithReport with multiple findings returns per-finding entries", () => {
  const validator = new StructuredOutputValidator();
  const f1 = finding({ findingId: "F1", traceability: lineRangeTraceability(21, 22) });
  const f2 = finding({ findingId: "F2", traceability: lineRangeTraceability(21, 22), type: "nice"});
  const result = validator.validateWithReport({
    responseText: payload([f1, f2]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  assert.equal(result.payload.findings.length, 2);
  assert.equal(result.report.length, 2);
  assert.equal(result.report[0].findingId, "F1");
  assert.equal(result.report[1].findingId, "F2");
});

test("validateWithReport throws with per-finding schema failure report entries", () => {
  const validator = new StructuredOutputValidator();
  const accepted = finding({ findingId: "F1", traceability: lineRangeTraceability(21, 22) });
  const rejected = finding({ findingId: "F2", traceability: lineRangeTraceability(21, 22), type: "maybe" });
  const error = captureStructuredValidationReportError(
    () =>
      validator.validateWithReport({
        responseText: payload([accepted, rejected]),
        diffContent: DEFAULT_DIFF,
        filePath: "src/app.ts"
      })
  );

  const rejectedEntry = error.report.find((entry) => entry.findingId === "F2");
  assert.equal(rejectedEntry?.taxonomy, "SCHEMA");
  assert.equal(rejectedEntry?.outcome, "rejected");
  assert.equal(rejectedEntry?.gate, "schema");
  assert.match(rejectedEntry?.reason ?? "", /'type' must be 'must' or 'nice'/u);
  assert.equal(
    error.report.find((entry) => entry.findingId === "F1")?.outcome,
    "accepted"
  );
});

test("validateWithReport throws with per-finding anchor failure report entries", () => {
  const validator = new StructuredOutputValidator();
  const accepted = finding({ findingId: "F1", traceability: lineRangeTraceability(21, 22) });
  const rejected = finding({ findingId: "F2", traceability: lineRangeTraceability(14, 18) });
  const error = captureStructuredValidationReportError(
    () =>
      validator.validateWithReport({
        responseText: payload([accepted, rejected]),
        diffContent: DEFAULT_DIFF,
        filePath: "src/app.ts"
      })
  );

  const rejectedEntry = error.report.find((entry) => entry.findingId === "F2");
  assert.equal(rejectedEntry?.taxonomy, "ANCHOR");
  assert.equal(rejectedEntry?.outcome, "rejected");
  assert.equal(rejectedEntry?.gate, "anchor");
  assert.match(rejectedEntry?.reason ?? "", /\[ANCHOR\]/u);
});

test("validateWithReport throws with duplicate findingId report entries", () => {
  const validator = new StructuredOutputValidator();
  const first = finding({ findingId: "F1", traceability: lineRangeTraceability(21, 22) });
  const duplicate = finding({ findingId: "F1", traceability: lineRangeTraceability(21, 22), title: "duplicate finding" });
  const error = captureStructuredValidationReportError(
    () =>
      validator.validateWithReport({
        responseText: payload([first, duplicate]),
        diffContent: DEFAULT_DIFF,
        filePath: "src/app.ts"
      })
  );

  const duplicateEntry = error.report.find(
    (entry) => entry.findingId === "F1" && entry.taxonomy === "DUPLICATE"
  );
  assert.equal(duplicateEntry?.outcome, "rejected");
  assert.equal(duplicateEntry?.gate, "schema");
  assert.match(duplicateEntry?.reason ?? "", /duplicate findingId 'F1'/u);
});

test("validateWithReport throws on unreportable top-level schema errors", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () => validator.validateWithReport({ responseText: "not json" }),
    /deterministic validation failed/u
  );
});

test("filterByAcceptanceWithReport accepts supported credible finding with OK taxonomy", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({ traceability: lineRangeTraceability(21, 22) });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].findingId, "F1");
  assert.equal(result.report[0].taxonomy, "OK");
  assert.equal(result.report[0].outcome, "accepted");
  assert.equal(result.report[0].gate, "acceptance");
});

test("filterByAcceptanceWithReport rejects tentative finding with EVIDENCE taxonomy", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({ traceability: lineRangeTraceability(21, 22), uncertaintyStatus: "tentative" });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 0);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].taxonomy, "EVIDENCE");
  assert.equal(result.report[0].outcome, "rejected");
  assert.equal(result.report[0].gate, "acceptance");
});

test("filterByAcceptanceWithReport rejects non-credible reachability with REACHABILITY taxonomy", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({
    traceability: lineRangeTraceability(21, 22),
    reachability: {
      credible: false,
      entryPoint: "handleRequest",
      guardsChecked: ["guard checked"]
    }
  });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 0);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].taxonomy, "REACHABILITY");
  assert.equal(result.report[0].outcome, "rejected");
});

test("filterByAcceptanceWithReport accepts finding once deterministic gates pass", () => {
  const validator = new StructuredOutputValidator();
  const f = finding({ traceability: lineRangeTraceability(21, 22) });
  const validated = validator.validate({
    responseText: payload([f]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.report.length, 1);
  assert.equal(result.report[0].taxonomy, "OK");
  assert.equal(result.report[0].outcome, "accepted");
});

test("filterByAcceptanceWithReport with mixed accepted and rejected findings", () => {
  const validator = new StructuredOutputValidator();
  const accepted = finding({ findingId: "F1", traceability: lineRangeTraceability(21, 22) });
  const rejectedUncertainty = finding({ findingId: "F2", traceability: lineRangeTraceability(21, 22), uncertaintyStatus: "unsupported" });
  const validated = validator.validate({
    responseText: payload([accepted, rejectedUncertainty]),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  const result = validator.filterByAcceptanceWithReport(validated);
  assert.equal(result.payload.findings.length, 1);
  assert.equal(result.payload.findings[0].findingId, "F1");
  assert.equal(result.report.length, 2);

  const okEntry = result.report.find(e => e.findingId === "F1");
  assert.equal(okEntry?.taxonomy, "OK");
  assert.equal(okEntry?.outcome, "accepted");

  const rejEntry = result.report.find(e => e.findingId === "F2");
  assert.equal(rejEntry?.taxonomy, "EVIDENCE");
  assert.equal(rejEntry?.outcome, "rejected");
});
