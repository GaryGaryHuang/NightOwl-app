import assert from "node:assert/strict";
import test from "node:test";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import {
  assertDispositionValidationFails,
  DEFAULT_DIFF,
  disposition,
  finding,
  lineRangeTraceability,
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

  assert.equal(result.findingUpdates.length, 1);
  assert.equal(result.findingUpdates[0]!.findingId, "F1");
  assert.equal(result.dispositions.length, 1);
  assert.equal(result.dispositions[0]!.findingId, "F1");
  assert.equal(result.dispositions[0]!.status, "retained");
});

test("validateWithDispositionsAndReport records anchor warnings without rejecting payload", () => {
  const result = new StructuredOutputValidator().validateWithDispositionsAndReport({
    responseText: verifiedPayload(
      [
        verifiedFinding({
          traceability: lineRangeTraceability(14, 18)
        })
      ],
      [disposition()]
    ),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });

  assert.equal(result.payload.findingUpdates.length, 1);
  const warning = result.report.find(
    (entry) => entry.findingId === "F1" && entry.gate === "anchor"
  );
  assert.equal(warning?.taxonomy, "ANCHOR");
  assert.equal(warning?.outcome, "accepted");
});

test("validateWithDispositions accepts VerifiedFindingSet schemaVersion 2", () => {
  const result = validateWithDispositions({
    responseText: JSON.stringify({
      schemaVersion: 2,
      findingUpdates: [verifiedFinding()],
      dispositions: [disposition()]
    })
  });

  assert.equal(result.schemaVersion, 2);
});

test("validateWithDispositions accepts empty findings and dispositions", () => {
  const result = validateWithDispositions({
    responseText: verifiedPayload([], [])
  });

  assert.deepEqual(result, { schemaVersion: 2, findingUpdates: [], dispositions: [] });
});

test("validateWithDispositions rejects missing dispositions key", () => {
  assertDispositionValidationFails({
    label: "missing dispositions",
    responseText: payload([finding()])
  });
});

test("validateWithDispositions rejects missing findingUpdates key", () => {
  assertDispositionValidationFails({
    label: "missing findingUpdates",
    responseText: JSON.stringify({ dispositions: [disposition()] })
  });
});

test("validateWithDispositions rejects unknown top-level field", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: JSON.stringify({
          findingUpdates: [verifiedFinding()],
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

test("validateWithDispositions rejects duplicate findingId in findingUpdates", () => {
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

test("validateWithDispositions accepts thin finding updates", () => {
  const result = validateWithDispositions({
    responseText: verifiedPayload([finding()], [disposition()])
  });

  assert.equal(result.findingUpdates.length, 1);
  assert.equal(result.findingUpdates[0]!.findingId, "F1");
});

test("validateWithDispositions rejects removed verifierVerdict metadata", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [verifiedFinding({ verifierVerdict: { status: "accepted" } })],
          [disposition()]
        )
      }),
    /verifierVerdict/u
  );
});

test("validateWithDispositions rejects removed uncertainty metadata", () => {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: verifiedPayload(
          [verifiedFinding({ uncertaintyStatus: "tentative" })],
          [disposition()]
        )
      }),
    /uncertaintyStatus/u
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
    acceptedFindingIds: ["F1"],
    findingUpdateIds: []
  });
});

test("validateDispositionCompleteness rejects retained candidates with non-SUPPORTED reason", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retained", reason: "REACHABILITY", explanation: "not reachable" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: ["F1"],
        findingUpdateIds: []
      }),
    /retained.*F1.*reason.*SUPPORTED/u
  );
});

test("validateDispositionCompleteness rejects modified candidates with non-SUPPORTED reason", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "modified", reason: "EVIDENCE", explanation: "updated" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: ["F1"],
        findingUpdateIds: ["F1"]
      }),
    /modified.*F1.*reason.*SUPPORTED/u
  );
});

test("validateDispositionCompleteness rejects retired candidates with SUPPORTED reason", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retired", reason: "SUPPORTED", explanation: "still valid" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: [],
        findingUpdateIds: []
      }),
    /retired.*F1.*must not use.*SUPPORTED/u
  );
});

test("validateDispositionCompleteness rejects retained candidates that appear in findingUpdates", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "still valid" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: ["F1"],
        findingUpdateIds: ["F1"]
      }),
    /retained.*F1.*must not appear in findingUpdates/u
  );
});

test("validateDispositionCompleteness rejects retired candidates that appear in findingUpdates", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retired", reason: "REACHABILITY", explanation: "gone" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: [],
        findingUpdateIds: ["F1"]
      }),
    /retired.*F1.*must not appear in findingUpdates/u
  );
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
        acceptedFindingIds: ["F1"],
        findingUpdateIds: []
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
        acceptedFindingIds: [],
        findingUpdateIds: []
      }),
    /unknown candidate.*F99/u
  );
});

test("validateDispositionCompleteness throws when disposition references a new accepted finding", () => {
  const validator = new StructuredOutputValidator();
  assert.throws(
    () =>
      validator.validateDispositionCompleteness({
        dispositions: [
          { findingId: "F1", status: "retained", reason: "SUPPORTED", explanation: "ok" },
          { findingId: "F3", status: "retired", reason: "REACHABILITY", explanation: "new finding is retired" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: ["F1", "F3"],
        findingUpdateIds: ["F3"]
      }),
    /unknown candidate.*F3/u
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
        acceptedFindingIds: [],
        findingUpdateIds: []
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
          { findingId: "F1", status: "modified", reason: "SUPPORTED", explanation: "updated" }
        ],
        candidateFindingIds: ["F1"],
        acceptedFindingIds: [],
        findingUpdateIds: ["F1"]
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
    acceptedFindingIds: [],
    findingUpdateIds: []
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
        acceptedFindingIds: ["F1"],
        findingUpdateIds: []
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
    acceptedFindingIds: ["F1", "F3"],
    findingUpdateIds: ["F3"]
  });
});
