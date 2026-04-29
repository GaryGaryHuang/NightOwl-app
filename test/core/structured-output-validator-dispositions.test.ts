import assert from "node:assert/strict";
import test from "node:test";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import {
  acceptedVerifierVerdict,
  assertDispositionValidationFails,
  disposition,
  finding,
  payload,
  validateWithDispositions,
  verifiedFinding,
  verifiedPayload
} from "../helpers/structured-output-validator-fixture.ts";

test("validateWithDispositions accepts valid findings and dispositions", () => {
  const f = verifiedFinding();
  const d = disposition();
  const result = validateWithDispositions({
    responseText: verifiedPayload([f], [d])
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.findingId, "F1");
  assert.equal(result.dispositions.length, 1);
  assert.equal(result.dispositions[0]!.findingId, "F1");
  assert.equal(result.dispositions[0]!.status, "retained");
});

test("validateWithDispositions accepts VerifiedFindingSet schemaVersion 2", () => {
  const result = validateWithDispositions({
    responseText: JSON.stringify({
      schemaVersion: 2,
      findings: [verifiedFinding()],
      dispositions: [disposition()]
    })
  });

  assert.equal(result.schemaVersion, 2);
});

test("validateWithDispositions accepts empty findings and dispositions", () => {
  const result = validateWithDispositions({
    responseText: verifiedPayload([], [])
  });

  assert.deepEqual(result, { schemaVersion: 2, findings: [], dispositions: [] });
});

test("validateWithDispositions rejects missing dispositions key", () => {
  assertDispositionValidationFails({
    label: "missing dispositions",
    responseText: payload([finding()])
  });
});

test("validateWithDispositions rejects missing findings key", () => {
  assertDispositionValidationFails({
    label: "missing findings",
    responseText: JSON.stringify({ dispositions: [disposition()] })
  });
});

test("validateWithDispositions rejects unknown top-level field", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: JSON.stringify({
          findings: [verifiedFinding()],
          dispositions: [disposition()],
          metadata: {}
        })
      }),
    /unknown field/u
  );
});

test("validateWithDispositions rejects unsupported VerifiedFindingSet schemaVersion", () => {
  assertDispositionValidationFails({
    responseText: JSON.stringify({
      schemaVersion: 1,
      findings: [],
      dispositions: []
    })
  });
});

test("validateWithDispositions rejects non-array dispositions", () => {
  assertDispositionValidationFails({
    label: "dispositions is object",
    responseText: JSON.stringify({ schemaVersion: 2, findings: [], dispositions: {} })
  });
});

test("validateWithDispositions rejects disposition missing findingId", () => {
  assertDispositionValidationFails({
    label: "missing findingId",
    responseText: verifiedPayload([], [
      { status: "retained", reason: "R", explanation: "E" }
    ])
  });
});

test("validateWithDispositions rejects disposition missing status", () => {
  assertDispositionValidationFails({
    label: "missing status",
    responseText: verifiedPayload([], [
      { findingId: "F1", reason: "R", explanation: "E" }
    ])
  });
});

test("validateWithDispositions rejects disposition missing reason", () => {
  assertDispositionValidationFails({
    label: "missing reason",
    responseText: verifiedPayload([], [
      { findingId: "F1", status: "retained", explanation: "E" }
    ])
  });
});

test("validateWithDispositions rejects disposition missing explanation", () => {
  assertDispositionValidationFails({
    label: "missing explanation",
    responseText: verifiedPayload([], [
      { findingId: "F1", status: "retained", reason: "R" }
    ])
  });
});

test("validateWithDispositions rejects invalid disposition status", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload([], [
          disposition({ status: "promoted" })
        ])
      }),
    /retained.*modified.*retired/u
  );
});

test("validateWithDispositions rejects unknown field in disposition", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload([], [
          disposition({ extraField: "bad" })
        ])
      }),
    /unknown field/u
  );
});

test("validateWithDispositions rejects duplicate findingId in dispositions", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload([], [
          disposition({ findingId: "F1" }),
          disposition({ findingId: "F1" })
        ])
      }),
    /duplicate/u
  );
});

test("validateWithDispositions rejects duplicate findingId in findings", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [verifiedFinding({ findingId: "F1" }), verifiedFinding({ findingId: "F1" })],
          [disposition()]
        )
      }),
    /duplicate/u
  );
});

test("validateWithDispositions validates each disposition status value", () => {
  for (const status of ["retained", "modified", "retired"]) {
    const result = validateWithDispositions({
      responseText: verifiedPayload([], [disposition({ status })])
    });
    assert.equal(result.dispositions[0]!.status, status);
  }
});

test("validateWithDispositions validates each disposition reason value", () => {
  for (const reason of [
    "SUPPORTED",
    "ANCHOR",
    "EVIDENCE",
    "REACHABILITY",
    "OUT_OF_SCOPE",
    "DUPLICATE",
    "CONTRADICTION"
  ]) {
    const result = validateWithDispositions({
      responseText: verifiedPayload([], [disposition({ reason })])
    });
    assert.equal(result.dispositions[0]!.reason, reason);
  }
});

test("validateWithDispositions rejects invalid disposition reason", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload([], [
          disposition({ reason: "STALE_CONTEXT" })
        ])
      }),
    /SUPPORTED.*ANCHOR.*EVIDENCE.*REACHABILITY.*OUT_OF_SCOPE.*DUPLICATE.*CONTRADICTION/u
  );
});

test("validateWithDispositions rejects finding missing verifierVerdict", () => {
  assertDispositionValidationFails({
    responseText: verifiedPayload([finding()], [disposition()])
  });
});

test("validateWithDispositions rejects non-accepted verifierVerdict", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [verifiedFinding({ verifierVerdict: acceptedVerifierVerdict({ status: "rejected" }) })],
          [disposition()]
        )
      }),
    /verifierVerdict\.status.*accepted/u
  );
});

test("validateWithDispositions rejects verifierVerdict checks that do not pass", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [
            verifiedFinding({
              verifierVerdict: acceptedVerifierVerdict({
                checks: {
                  anchor: "pass",
                  evidence: "pass",
                  reachability: "fail",
                  impact: "pass",
                  scope: "pass",
                  duplicate: "pass"
                }
              })
            })
          ],
          [disposition()]
        )
      }),
    /verifierVerdict\.checks\.reachability.*pass/u
  );
});

test("validateWithDispositions rejects accepted findings that fail Step 6 acceptance gates", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [
            verifiedFinding({
              uncertaintyStatus: "tentative"
            })
          ],
          [disposition()]
        )
      }),
    /must be accepted.*uncertaintyStatus/u
  );
});

test("validateDispositionCompleteness passes when all candidates accounted for", () => {
  const validator = new StructuredOutputValidator();
  validator.validateDispositionCompleteness({
    dispositions: [
      { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" },
      { findingId: "F2", status: "retired", reason: "REACHABILITY", explanation: "not reachable" }
    ],
    candidateFindingIds: ["F1", "F2"],
    acceptedFindingIds: ["F1"]
  });
});

test("validateDispositionCompleteness throws when candidate is missing from dispositions", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" }
        ],
        candidateFindingIds: ["F1", "F2"],
        acceptedFindingIds: ["F1"]
      }),
    /missing disposition.*F2/u
  );
});

test("validateDispositionCompleteness throws when disposition references unknown candidate", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F99", status: "retired", reason: "ANCHOR", explanation: "bogus" }
        ],
        candidateFindingIds: [],
        acceptedFindingIds: []
      }),
    /unknown candidate.*F99/u
  );
});

test("validateDispositionCompleteness throws when retained candidate missing from findings", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: []
      }),
    /retained.*F1.*must appear in findings/u
  );
});

test("validateDispositionCompleteness throws when modified candidate missing from findings", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "modified", reason: "EVIDENCE", explanation: "updated" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: []
      }),
    /modified.*F1.*must appear in findings/u
  );
});

test("validateDispositionCompleteness passes when retired candidate absent from findings", () => {
  const validator = new StructuredOutputValidator();
  validator.validateDispositionCompleteness({
    dispositions: [
      { findingId: "F1", status: "retired", reason: "REACHABILITY", explanation: "gone" }
    ],
    candidateFindingIds: ["F1"],
    acceptedFindingIds: []
  });
});

test("validateDispositionCompleteness throws when retired candidate appears in findings", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retired", reason: "REACHABILITY", explanation: "gone" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: ["F1"]
      }),
    /retired.*F1.*must not appear in findings/u
  );
});

test("validateDispositionCompleteness allows new findings without disposition entry", () => {
  const validator = new StructuredOutputValidator();
  validator.validateDispositionCompleteness({
    dispositions: [
      { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" }
    ],
    candidateFindingIds: ["F1"],
    acceptedFindingIds: ["F1", "F3"]
  });
});
