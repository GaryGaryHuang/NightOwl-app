import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangesetOverviewOutputValidationError,
  ChangesetOverviewOutputValidator
} from "../../src/core/changeset-overview-output-validator.ts";
import type { ChangeMapReadiness } from "../../src/core/change-map.ts";

const expectedUserContext = ["Root Cause: context loss before Candidate Findings"];

function makeValidChangeMap(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    reviewObjective: {
      summary: "Review prompt harness redesign",
      requestedFocus: ["evidence chain"],
      expectedBehaviorSummary: ["Candidate Findings uses structured ReviewBasis"]
    },
    userBehavior: [
      {
        statement: "Candidate findings must cite evidence refs",
        confidence: "explicit"
      }
    ],
    missingInformation: [
      {
        description: "No live media SDK callback contract",
        whyItMatters: "priority decision would be blocked"
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
        description: "Changeset Overview records run-level behavior context",
        files: ["src/app.ts"]
      }
    ],
    ...overrides
  });
}

function validateChangeMap(
  responseText: string,
  userContext: readonly string[] = expectedUserContext
): ChangeMapReadiness {
  return new ChangesetOverviewOutputValidator().validate({
    responseText,
    userContext
  });
}

function expectFailure(
  fn: () => void,
  code: ChangesetOverviewOutputValidationError["code"],
  messagePattern?: RegExp
): ChangesetOverviewOutputValidationError {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof ChangesetOverviewOutputValidationError,
      `expected ChangesetOverviewOutputValidationError, received ${(error as Error)?.constructor?.name ?? typeof error}`
    );
    assert.equal((error as ChangesetOverviewOutputValidationError).code, code);
    if (messagePattern) {
      assert.match((error as Error).message, messagePattern);
    }
    return error as ChangesetOverviewOutputValidationError;
  }
  throw new Error(`expected validator to throw with code ${code}`);
}

test("ChangesetOverviewOutputValidator accepts valid output and injects userContext from host", () => {
  const changeMap = validateChangeMap(makeValidChangeMap());

  assert.deepEqual(changeMap.userContext, expectedUserContext);
  assert.equal(changeMap.userBehavior[0]?.statement, "Candidate findings must cite evidence refs");
  assert.equal(changeMap.userBehavior[0]?.confidence, "explicit");
  assert.equal(changeMap.missingInformation[0]?.whyItMatters, "priority decision would be blocked");
  assert.equal(changeMap.behaviorChanges[0]?.files[0], "src/app.ts");
});

test("ChangesetOverviewOutputValidator ignores unknown top-level fields", () => {
  const changeMap = validateChangeMap(makeValidChangeMap({ changedFiles: [], schemaVersion: 2 }));
  assert.ok(changeMap.reviewObjective);
});

test("ChangesetOverviewOutputValidator accepts behaviorChanges with extra fields and any file paths", () => {
  const changeMap = validateChangeMap(
    makeValidChangeMap({
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

test("ChangesetOverviewOutputValidator returns a deeply frozen ChangeMapReadiness", () => {
  const changeMap = validateChangeMap(makeValidChangeMap());

  assert.ok(Object.isFrozen(changeMap));
  assert.ok(Object.isFrozen(changeMap.reviewObjective));
  assert.ok(Object.isFrozen(changeMap.reviewObjective.requestedFocus));
  assert.ok(Object.isFrozen(changeMap.userContext));
  assert.ok(Object.isFrozen(changeMap.userBehavior));
  assert.ok(Object.isFrozen(changeMap.userBehavior[0]));
  assert.ok(Object.isFrozen(changeMap.missingInformation));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges[0]?.files));

  assert.throws(() => {
    (changeMap.behaviorChanges as unknown as { push: (entry: unknown) => void }).push({});
  }, TypeError);
});

test("ChangesetOverviewOutputValidator rejects invalid JSON with PARSE diagnostics", () => {
  expectFailure(
    () =>
      new ChangesetOverviewOutputValidator().validate({
        responseText: "not json",
        userContext: []
      }),
    "PARSE"
  );

  const error = expectFailure(
    () =>
      new ChangesetOverviewOutputValidator().validate({
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

test("ChangesetOverviewOutputValidator syntax-repairs code fences and harmless prose around JSON", () => {
  const validator = new ChangesetOverviewOutputValidator();
  const fenced = validator.validateDetailed({
    responseText: ["```json", makeValidChangeMap(), "```"].join("\n"),
    userContext: expectedUserContext
  });
  const extracted = validator.validateDetailed({
    responseText: ["Here is the result:", makeValidChangeMap(), "Done."].join("\n"),
    userContext: expectedUserContext
  });

  assert.equal(fenced.parseMetadata.repairKind, "code_fence");
  assert.equal(extracted.parseMetadata.repairKind, "object_extraction");
});

test("ChangesetOverviewOutputValidator rejects ambiguous or truncated JSON without repair", () => {
  const validator = new ChangesetOverviewOutputValidator();
  const multiple = expectFailure(
    () =>
      validator.validate({
        responseText: [makeValidChangeMap(), makeValidChangeMap()].join("\n"),
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

test("ChangesetOverviewOutputValidator rejects non-object payload", () => {
  expectFailure(
    () =>
      new ChangesetOverviewOutputValidator().validate({
        responseText: "[]",
        userContext: []
      }),
    "SCHEMA"
  );
});

test("ChangesetOverviewOutputValidator normalizes overviewMarkdown presentation drift", () => {
  const extraSpace = validateChangeMap(makeValidChangeMap({
    overviewMarkdown: " ## Changeset Overview\nx"
  }));
  const lowercase = validateChangeMap(makeValidChangeMap({
    overviewMarkdown: "## changeset overview\nx"
  }));
  const missingHeader = validateChangeMap(makeValidChangeMap({
    overviewMarkdown: "Scope: feature"
  }));

  assert.equal(extraSpace.overviewMarkdown.startsWith("## Changeset Overview"), true);
  assert.equal(lowercase.overviewMarkdown, "## Changeset Overview\nx");
  assert.equal(missingHeader.overviewMarkdown, "## Changeset Overview\nScope: feature");
});

test("ChangesetOverviewOutputValidator allows empty behaviorChanges", () => {
  const changeMap = validateChangeMap(
    makeValidChangeMap({ behaviorChanges: [] })
  );

  assert.equal(changeMap.behaviorChanges.length, 0);
});

test("ChangesetOverviewOutputValidator defaults invalid userBehavior confidence to inferred", () => {
  const changeMap = validateChangeMap(
    makeValidChangeMap({
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

test("ChangesetOverviewOutputValidator defaults missing optional arrays to empty arrays", () => {
  const changeMap = validateChangeMap(
    makeValidChangeMap({
      behaviorChanges: undefined,
      missingInformation: undefined,
      reviewObjective: {
        summary: "Review prompt harness redesign"
      },
      userBehavior: undefined
    })
  );

  assert.deepEqual(changeMap.reviewObjective.requestedFocus, []);
  assert.deepEqual(changeMap.reviewObjective.expectedBehaviorSummary, []);
  assert.deepEqual(changeMap.behaviorChanges, []);
  assert.deepEqual(changeMap.missingInformation, []);
  assert.deepEqual(changeMap.userBehavior, []);
});

test("ChangesetOverviewOutputValidator drops malformed optional entries and preserves usable fields", () => {
  const changeMap = validateChangeMap(
    makeValidChangeMap({
      behaviorChanges: [
        null,
        { files: ["src/missing-description.ts"] },
        { description: "single-file behavior", files: "src/app.ts" }
      ],
      missingInformation: [
        "not an object",
        { description: "Need SDK contract" }
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
  assert.equal(changeMap.userBehavior[0]?.confidence, "inferred");
});

test("ChangesetOverviewOutputValidator rejects an empty object with no usable review context", () => {
  expectFailure(
    () =>
      validateChangeMap(
        JSON.stringify({})
      ),
    "SCHEMA"
  );
});
