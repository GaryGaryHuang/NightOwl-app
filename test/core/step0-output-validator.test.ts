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

const expectedUserContext = ["Root Cause: context loss before Step 5"];

function makeValidV2(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    reviewObjective: {
      summary: "Review prompt harness redesign",
      requestedFocus: ["evidence chain"],
      expectedBehaviorSummary: ["Step 5 uses structured ReviewBasis"]
    },
    userBehavior: [
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
    overviewMarkdown: [
      "## Changeset Overview",
      "- Scope: feature",
      "- Cross-file boundaries: none",
      "- Behavior changes: adds structured run context",
      "- Test coverage observations: no corresponding test changes observed"
    ].join("\n"),
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
  userContext: readonly string[] = expectedUserContext
): ChangeMapReadinessV2 {
  return new Step0OutputValidator().validate({
    responseText,
    userContext
  });
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

test("Step0OutputValidator accepts valid output and injects userContext from host", () => {
  const changeMap = validateV2(makeValidV2());

  assert.deepEqual(changeMap.userContext, expectedUserContext);
  assert.equal(changeMap.userBehavior[0]?.statement, "Candidate findings must cite evidence refs");
  assert.equal(changeMap.userBehavior[0]?.confidence, "explicit");
  assert.equal(changeMap.missingInformation[0]?.whyItMatters, "severity classification would be blocked");
  assert.equal(changeMap.behaviorChanges[0]?.files[0], "src/app.ts");
});

test("Step0OutputValidator ignores unknown top-level fields", () => {
  const changeMap = validateV2(makeValidV2({ changedFiles: [], schemaVersion: 2 }));
  assert.ok(changeMap.reviewObjective);
});

test("Step0OutputValidator accepts behaviorChanges with extra fields and any file paths", () => {
  const changeMap = validateV2(
    makeValidV2({
      behaviorChanges: [
        {
          description: "references a file not in changeset",
          files: ["src/not-in-changeset.ts"],
          extraField: true
        }
      ]
    })
  );

  assert.equal(changeMap.behaviorChanges[0]?.files[0], "src/not-in-changeset.ts");
});

test("Step0OutputValidator accepts unresolvedUnknowns with extra fields", () => {
  const changeMap = validateV2(
    makeValidV2({
      unresolvedUnknowns: [
        {
          question: "API 版本？",
          blocksFinding: true,
          resolutionPath: "查 package.json"
        }
      ]
    })
  );

  assert.equal(changeMap.unresolvedUnknowns[0]?.question, "API 版本？");
});

test("Step0OutputValidator returns a deeply frozen ChangeMapReadinessV2", () => {
  const changeMap = validateV2(makeValidV2());

  assert.ok(Object.isFrozen(changeMap));
  assert.ok(Object.isFrozen(changeMap.reviewObjective));
  assert.ok(Object.isFrozen(changeMap.reviewObjective.requestedFocus));
  assert.ok(Object.isFrozen(changeMap.userContext));
  assert.ok(Object.isFrozen(changeMap.userBehavior));
  assert.ok(Object.isFrozen(changeMap.userBehavior[0]));
  assert.ok(Object.isFrozen(changeMap.missingInformation));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges[0]?.files));
  assert.ok(Object.isFrozen(changeMap.unresolvedUnknowns));

  assert.throws(() => {
    (changeMap.behaviorChanges as unknown as { push: (entry: unknown) => void }).push({});
  }, TypeError);
});

test("Step0OutputValidator rejects invalid JSON with PARSE diagnostics", () => {
  expectFailure(
    () =>
      new Step0OutputValidator().validate({
        responseText: "not json",
        userContext: []
      }),
    "PARSE"
  );

  const error = expectFailure(
    () =>
      new Step0OutputValidator().validate({
        responseText: '"not an object" trailing assistant text',
        userContext: []
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

test("Step0OutputValidator syntax-repairs code fences and harmless prose around JSON", () => {
  const validator = new Step0OutputValidator();
  const fenced = validator.validateDetailed({
    responseText: ["```json", makeValidV2(), "```"].join("\n"),
    userContext: expectedUserContext
  });
  const extracted = validator.validateDetailed({
    responseText: ["Here is the result:", makeValidV2(), "Done."].join("\n"),
    userContext: expectedUserContext
  });

  assert.equal(fenced.parseMetadata.repairKind, "code_fence");
  assert.equal(extracted.parseMetadata.repairKind, "object_extraction");
});

test("Step0OutputValidator rejects ambiguous or truncated JSON without repair", () => {
  const validator = new Step0OutputValidator();
  const multiple = expectFailure(
    () =>
      validator.validate({
        responseText: [makeValidV2(), makeValidV2()].join("\n"),
        userContext: expectedUserContext
      }),
    "PARSE",
    /multiple root JSON objects/u
  );
  assert.equal(multiple.diagnostic.parseStage, "root_object_detection");

  const truncated = expectFailure(
    () =>
      validator.validate({
        responseText: '{"reviewObjective":{',
        userContext: []
      }),
    "PARSE"
  );
  assert.equal(truncated.diagnostic.parseStage, "initial_parse");
});

test("Step0OutputValidator rejects non-object payload", () => {
  expectFailure(
    () =>
      new Step0OutputValidator().validate({
        responseText: "[]",
        userContext: []
      }),
    "SCHEMA"
  );
});

test("Step0OutputValidator normalizes overviewMarkdown presentation drift", () => {
  const extraSpace = validateV2(makeValidV2({
    overviewMarkdown: " ## Changeset Overview\nx"
  }));
  const lowercase = validateV2(makeValidV2({
    overviewMarkdown: "## changeset overview\nx"
  }));
  const missingHeader = validateV2(makeValidV2({
    overviewMarkdown: "Scope: feature"
  }));

  assert.equal(extraSpace.overviewMarkdown.startsWith("## Changeset Overview"), true);
  assert.equal(lowercase.overviewMarkdown, "## Changeset Overview\nx");
  assert.equal(missingHeader.overviewMarkdown, "## Changeset Overview\nScope: feature");
});

test("Step0OutputValidator allows empty behaviorChanges and unresolvedUnknowns", () => {
  const changeMap = validateV2(
    makeValidV2({ behaviorChanges: [], unresolvedUnknowns: [] })
  );

  assert.equal(changeMap.behaviorChanges.length, 0);
  assert.equal(changeMap.unresolvedUnknowns.length, 0);
});

test("Step0OutputValidator defaults invalid userBehavior confidence to inferred", () => {
  const changeMap = validateV2(
    makeValidV2({
      userBehavior: [
        {
          statement: "Candidate findings must cite evidence refs",
          confidence: "certain"
        }
      ]
    })
  );

  assert.equal(changeMap.userBehavior[0]?.confidence, "inferred");
});

test("Step0OutputValidator defaults missing optional arrays to empty arrays", () => {
  const changeMap = validateV2(
    makeValidV2({
      behaviorChanges: undefined,
      missingInformation: undefined,
      reviewObjective: {
        summary: "Review prompt harness redesign"
      },
      unresolvedUnknowns: undefined,
      userBehavior: undefined
    })
  );

  assert.deepEqual(changeMap.reviewObjective.requestedFocus, []);
  assert.deepEqual(changeMap.reviewObjective.expectedBehaviorSummary, []);
  assert.deepEqual(changeMap.behaviorChanges, []);
  assert.deepEqual(changeMap.missingInformation, []);
  assert.deepEqual(changeMap.unresolvedUnknowns, []);
  assert.deepEqual(changeMap.userBehavior, []);
});

test("Step0OutputValidator drops malformed optional entries and preserves usable fields", () => {
  const changeMap = validateV2(
    makeValidV2({
      behaviorChanges: [
        null,
        { files: ["src/missing-description.ts"] },
        { description: "single-file behavior", files: "src/app.ts" }
      ],
      missingInformation: [
        "not an object",
        { description: "Need SDK contract" }
      ],
      unresolvedUnknowns: [
        {},
        { question: "Which API version is used?" }
      ],
      userBehavior: [
        [],
        { statement: "Expected behavior is stated" }
      ]
    })
  );

  assert.deepEqual(changeMap.behaviorChanges[0], {
    description: "single-file behavior",
    files: ["src/app.ts"]
  });
  assert.ok((changeMap.missingInformation[0]?.whyItMatters.length ?? 0) > 0);
  assert.ok((changeMap.unresolvedUnknowns[0]?.resolutionPath.length ?? 0) > 0);
  assert.equal(changeMap.userBehavior[0]?.confidence, "inferred");
});

test("Step0OutputValidator rejects an empty object with no usable review context", () => {
  expectFailure(
    () =>
      validateV2(
        JSON.stringify({})
      ),
    "SCHEMA"
  );
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

test("extractChangedPathsFromChangesetEntries preserves duplicates", () => {
  const result = extractChangedPathsFromChangesetEntries([
    { status: "M", path: "src/dup.ts" },
    { status: "M", path: "src/dup.ts" }
  ]);
  assert.deepEqual([...result], ["src/dup.ts", "src/dup.ts"]);
});
