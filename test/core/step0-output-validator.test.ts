import assert from "node:assert/strict";
import test from "node:test";

import {
  Step0OutputValidationError,
  Step0OutputValidator
} from "../../src/core/step0-output-validator.ts";
import {
  type ChangeMapReadinessV2,
  extractChangedPathsFromChangesetEntries
} from "../../src/core/change-map.ts";

const expectedSinglePath: readonly string[] = ["src/app.ts"];
const expectedUserContext = ["Root Cause: context loss before Step 5"];

function makeRejectedV1Payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown: "## Changeset Overview\n- 調整範圍：feature",
    ...overrides
  });
}

function makeValidV2(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 2,
    reviewObjective: {
      summary: "Review prompt harness redesign",
      requestedFocus: ["evidence chain"],
      expectedBehaviorSummary: ["Step 5 uses structured ReviewBasis"]
    },
    userContextSSOT: expectedUserContext,
    expectedBehaviorLedger: [
      {
        statement: "Candidate findings must cite evidence refs",
        confidence: "explicit"
      }
    ],
    missingInformation: [
      {
        description: "No live KKBOX SDK callback contract",
        whyItMatters: "severity classification would be blocked"
      }
    ],
    overviewMarkdown: "## Changeset Overview\n- Phase 1 readiness",
    behaviorChanges: [
      {
        description: "Step 0 records run-level behavior context",
        files: ["src/app.ts"]
      }
    ],
    unresolvedUnknowns: [],
    ...overrides
  });
}

function validateV2(
  responseText: string,
  expectedChangedPaths: readonly string[] = expectedSinglePath,
  expectedContext: readonly string[] = expectedUserContext
): ChangeMapReadinessV2 {
  const changeMap = new Step0OutputValidator().validate({
    responseText,
    expectedChangedPaths,
    expectedUserContext: expectedContext
  });
  assert.equal(changeMap.schemaVersion, 2);
  return changeMap;
}

function expectFailure(
  fn: () => void,
  code: Step0OutputValidationError["code"],
  messagePattern?: RegExp
): Step0OutputValidationError {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof Step0OutputValidationError,
      `expected Step0OutputValidationError, received ${(error as Error)?.constructor?.name ?? typeof error}`
    );
    assert.equal((error as Step0OutputValidationError).code, code);
    if (messagePattern) {
      assert.match((error as Error).message, messagePattern);
    }
    return error as Step0OutputValidationError;
  }
  throw new Error(`expected validator to throw with code ${code}`);
}

test("Step0OutputValidator rejects legacy schemaVersion 1 payloads", () => {
  const error = expectFailure(
    () =>
      new Step0OutputValidator().validate({
        responseText: makeRejectedV1Payload(),
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA",
    /schemaVersion must be the literal number 2/u
  );

  assert.equal(error.diagnostic.offendingPath, "schemaVersion");
  assert.deepEqual(error.diagnostic.allowedValues, ["2"]);
  assert.equal(error.diagnostic.actualSummary, "number");
  assert.match(error.diagnostic.repairHint ?? "", /schemaVersion: 2/u);
});

test("Step0OutputValidator accepts minimal ChangeMapReadinessV2 contract", () => {
  const changeMap = validateV2(makeValidV2());

  assert.deepEqual(changeMap.userContextSSOT, expectedUserContext);
  assert.equal(changeMap.expectedBehaviorLedger[0]?.statement, "Candidate findings must cite evidence refs");
  assert.equal(changeMap.expectedBehaviorLedger[0]?.confidence, "explicit");
  assert.equal(changeMap.missingInformation[0]?.whyItMatters, "severity classification would be blocked");
  assert.equal(changeMap.behaviorChanges[0]?.files[0], "src/app.ts");
});

test("Step0OutputValidator rejects removed v1 fields", () => {
  expectFailure(
    () => validateV2(makeValidV2({ changedFiles: [] })),
    "SCHEMA",
    /top-level contains unsupported field "changedFiles"/u
  );

  expectFailure(
    () =>
      validateV2(
        makeValidV2({
          unresolvedUnknowns: [
            {
              question: "API 版本？",
              blocksFinding: true,
              resolutionPath: "查 package.json"
            }
          ]
        })
      ),
    "SCHEMA",
    /unresolvedUnknowns\[0\] contains unsupported field "blocksFinding"/u
  );
});

test("Step0OutputValidator rejects behaviorChanges files outside changed_files_json paths", () => {
  expectFailure(
    () =>
      validateV2(
        makeValidV2({
          behaviorChanges: [
            {
              description: "references a missing file",
              files: ["src/not-in-changeset.ts"]
            }
          ]
        })
      ),
    "SCHEMA",
    /behaviorChanges\[0\]\.files\[0\].*<changed_files_json>\.entries\[\]\.path/u
  );
});

test("Step0OutputValidator fails with COVERAGE when expectedChangedPaths contains duplicates", () => {
  expectFailure(
    () =>
      new Step0OutputValidator().validate({
        responseText: makeValidV2(),
        expectedChangedPaths: ["src/app.ts", "src/app.ts"],
        expectedUserContext
      }),
    "COVERAGE",
    /expectedChangedPaths contains duplicate path/u
  );
});

test("Step0OutputValidator validates ordered userContextSSOT", () => {
  expectFailure(
    () =>
      validateV2(
        makeValidV2({ userContextSSOT: [{ rawText: "first" }] }),
        ["src/app.ts"],
        ["first"]
      ),
    "SCHEMA",
    /userContextSSOT\[0\] must be a string \(received object\)/u
  );

  expectFailure(
    () =>
      validateV2(
        makeValidV2({ userContextSSOT: ["second", "first"] }),
        ["src/app.ts"],
        ["first", "second"]
      ),
    "SCHEMA",
    /userContextSSOT\[0\] must preserve user context order/u
  );

  assert.deepEqual(
    validateV2(
      makeValidV2({ userContextSSOT: ["first", "second"] }),
      ["src/app.ts"],
      ["first", "second"]
    ).userContextSSOT,
    ["first", "second"]
  );
});

test("Step0OutputValidator returns a deeply frozen ChangeMapReadinessV2", () => {
  const changeMap = validateV2(makeValidV2());

  assert.ok(Object.isFrozen(changeMap));
  assert.ok(Object.isFrozen(changeMap.reviewObjective));
  assert.ok(Object.isFrozen(changeMap.reviewObjective.requestedFocus));
  assert.ok(Object.isFrozen(changeMap.userContextSSOT));
  assert.ok(Object.isFrozen(changeMap.expectedBehaviorLedger));
  assert.ok(Object.isFrozen(changeMap.expectedBehaviorLedger[0]));
  assert.ok(Object.isFrozen(changeMap.missingInformation));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges[0]?.files));
  assert.ok(Object.isFrozen(changeMap.unresolvedUnknowns));

  assert.throws(() => {
    (changeMap as unknown as { schemaVersion: number }).schemaVersion = 1;
  }, TypeError);
  assert.throws(() => {
    (changeMap.behaviorChanges as unknown as { push: (entry: unknown) => void }).push({});
  }, TypeError);
});

test("Step0OutputValidator rejects invalid JSON with PARSE diagnostics", () => {
  expectFailure(
    () =>
      new Step0OutputValidator().validate({
        responseText: "not json",
        expectedChangedPaths: []
      }),
    "PARSE"
  );

  const error = expectFailure(
    () =>
      new Step0OutputValidator().validate({
        responseText: '"not an object" trailing assistant text',
        expectedChangedPaths: []
      }),
    "PARSE",
    /Unexpected non-whitespace character after JSON/u
  );

  assert.equal(error.diagnostic.parseStage, "initial_parse");
  assert.equal(error.diagnostic.errorPosition, 16);
  assert.equal(error.diagnostic.errorLine, 1);
  assert.equal(error.diagnostic.errorColumn, 17);
  assert.match(error.diagnostic.responseExcerpt ?? "", /<<<ERROR>>>trailing assistant text/u);
});

test("Step0OutputValidator syntax-repairs code fences and harmless prose around V2 JSON", () => {
  const validator = new Step0OutputValidator();
  const fenced = validator.validateDetailed({
    responseText: ["```json", makeValidV2(), "```"].join("\n"),
    expectedChangedPaths: expectedSinglePath,
    expectedUserContext
  });
  const extracted = validator.validateDetailed({
    responseText: ["Here is the result:", makeValidV2(), "Done."].join("\n"),
    expectedChangedPaths: expectedSinglePath,
    expectedUserContext
  });

  assert.equal(fenced.changeMap.schemaVersion, 2);
  assert.equal(fenced.parseMetadata.repairKind, "code_fence");
  assert.equal(extracted.changeMap.schemaVersion, 2);
  assert.equal(extracted.parseMetadata.repairKind, "object_extraction");
});

test("Step0OutputValidator rejects ambiguous or truncated JSON without repair", () => {
  const validator = new Step0OutputValidator();
  const multiple = expectFailure(
    () =>
      validator.validate({
        responseText: [makeValidV2(), makeValidV2()].join("\n"),
        expectedChangedPaths: expectedSinglePath,
        expectedUserContext
      }),
    "PARSE",
    /multiple root JSON objects/u
  );
  assert.equal(multiple.diagnostic.parseStage, "root_object_detection");

  const truncated = expectFailure(
    () =>
      validator.validate({
        responseText: '{"schemaVersion":2',
        expectedChangedPaths: []
      }),
    "PARSE"
  );
  assert.equal(truncated.diagnostic.parseStage, "initial_parse");
});

test("Step0OutputValidator rejects non-object payload and non-literal schemaVersion 2", () => {
  expectFailure(
    () =>
      new Step0OutputValidator().validate({
        responseText: "[]",
        expectedChangedPaths: []
      }),
    "SCHEMA"
  );

  for (const schemaVersion of [3, "2"]) {
    const error = expectFailure(
      () =>
        new Step0OutputValidator().validate({
          responseText: makeValidV2({ schemaVersion }),
          expectedChangedPaths: expectedSinglePath,
          expectedUserContext
        }),
      "SCHEMA"
    );
    assert.deepEqual(error.diagnostic.allowedValues, ["2"]);
  }
});

test("Step0OutputValidator rejects overviewMarkdown without strict literal prefix", () => {
  for (const overviewMarkdown of [
    "##  Changeset Overview\nx",
    " ## Changeset Overview\nx",
    "## changeset overview\nx"
  ]) {
    expectFailure(() => validateV2(makeValidV2({ overviewMarkdown })), "SCHEMA");
  }
});

test("Step0OutputValidator rejects placeholder markers", () => {
  const cases = [
    "TODO",
    "behavior is TBD pending design",
    "N/A",
    "see <replace>",
    "fill me in",
    "placeholder text"
  ];

  for (const description of cases) {
    expectFailure(
      () =>
        validateV2(
          makeValidV2({
            behaviorChanges: [
              {
                description,
                files: ["src/app.ts"]
              }
            ]
          })
        ),
      "PLACEHOLDER"
    );
  }
});

test("Step0OutputValidator does not reject correctness keywords as a fatal validation gate", () => {
  const changeMap = validateV2(
    makeValidV2({
      behaviorChanges: [
        {
          description: "錯誤處理流程改為先回報 user context 指定的 Root Cause",
          files: ["src/app.ts"]
        }
      ]
    })
  );

  assert.equal(changeMap.behaviorChanges.length, 1);
});

test("Step0OutputValidator allows empty behaviorChanges and unresolvedUnknowns", () => {
  const changeMap = validateV2(
    makeValidV2({ behaviorChanges: [], unresolvedUnknowns: [] })
  );

  assert.equal(changeMap.behaviorChanges.length, 0);
  assert.equal(changeMap.unresolvedUnknowns.length, 0);
});

test("Step0OutputValidator reports invalid confidence enum diagnostics", () => {
  const error = expectFailure(
    () =>
      validateV2(
        makeValidV2({
          expectedBehaviorLedger: [
            {
              statement: "Candidate findings must cite evidence refs",
              confidence: "certain"
            }
          ]
        })
      ),
    "SCHEMA"
  );

  assert.equal(error.diagnostic.offendingPath, "expectedBehaviorLedger[0].confidence");
  assert.deepEqual(error.diagnostic.allowedValues, ["explicit", "inferred"]);
});

test("extractChangedPathsFromChangesetEntries handles regular, rename, copy, and empty-path-free entries", () => {
  const entries = [
    { status: "M" as const, path: "src/foo.ts" },
    { status: "A" as const, path: "src/bar.ts" },
    { status: "D" as const, path: "src/baz.ts" },
    { status: "R" as const, similarityScore: 100, previousPath: "old.ts", path: "new.ts" },
    { status: "C" as const, similarityScore: 75, previousPath: "src/a.ts", path: "src/b.ts" },
    { status: "M" as const, path: "src/qux.ts" }
  ];
  const result = extractChangedPathsFromChangesetEntries(entries);
  assert.deepEqual([...result], [
    "src/foo.ts",
    "src/bar.ts",
    "src/baz.ts",
    "new.ts",
    "src/b.ts",
    "src/qux.ts"
  ]);
});

test("extractChangedPathsFromChangesetEntries preserves duplicates so validator can surface host path duplication", () => {
  const result = extractChangedPathsFromChangesetEntries([
    { status: "M", path: "src/dup.ts" },
    { status: "M", path: "src/dup.ts" }
  ]);
  assert.deepEqual([...result], ["src/dup.ts", "src/dup.ts"]);
});
