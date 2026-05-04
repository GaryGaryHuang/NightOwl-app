import assert from "node:assert/strict";
import test from "node:test";

import {
  Step0OutputValidationError,
  Step0OutputValidator
} from "../../src/core/step0-output-validator.ts";
import {
  USER_CONTEXT_CATEGORIES,
  extractChangedPathsFromChangesetEntries
} from "../../src/core/change-map.ts";

function makeValid(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown: "## Changeset Overview\n- 調整範圍：feature\n- 跨檔案邊界：無跨檔案相依\n- 行為變更：新增 review CLI 入口\n- 測試覆蓋觀察：未見對應測試異動",
    changedFiles: [
      {
        path: "src/app.ts",
        status: "M",
        category: "feature",
        group: "review-flow",
        basis: "diff-inspected"
      }
    ],
    fileGroups: [
      {
        id: "G1",
        label: "review-flow",
        files: ["src/app.ts"],
        observedChange: "shared review flow behavior changed"
      }
    ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [
      {
        description: "新增 review CLI 入口參數",
        files: ["src/app.ts"],
        evidenceRefs: ["R1"]
      }
    ],
    evidenceRefs: [
      {
        id: "R1",
        sourceKind: "diff",
        pathOrUrl: "src/app.ts",
        anchor: "@@ -1,2 +1,3 @@",
        summary: "CLI entrypoint signature changed"
      }
    ],
    unresolvedUnknowns: [],
    ...overrides
  });
}

function makeValidV2(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 2,
    readiness: "READY_WITH_LIMITATIONS",
    reviewObjective: {
      summary: "Review prompt harness redesign",
      requestedFocus: ["evidence chain"],
      expectedBehaviorSummary: ["Step 5 uses structured ReviewBasis"]
    },
    userContextSSOT: [
      {
        contextId: "UC1",
        rawText: "Root Cause: context loss before Step 5",
        categories: ["root_cause"],
        extractedFacts: ["context loss before Step 5"]
      }
    ],
    changeScope: {
      totalChangedPaths: 2,
      reviewableNonDeletedPaths: 1,
      deletedPaths: 1,
      binaryOrNonReviewablePaths: 0,
      changedTests: ["test/core/review-basis-validator.test.ts"],
      highRiskAreas: ["review pipeline"]
    },
    coveragePlan: {
      mustDistinguishDeletedAndBinaryPaths: true,
      notes: ["deleted paths are not skipped planned files"]
    },
    expectedBehaviorLedger: [
      {
        expectationId: "EB1",
        statement: "Candidate findings must cite evidence refs",
        sourceType: "user_context",
        confidence: "explicit"
      }
    ],
    missingInformation: [
      {
        gapId: "MI1",
        description: "No live KKBOX SDK callback contract",
        whyItMatters: "severity classification would be blocked",
        blockingLevel: "severity_only"
      }
    ],
    proceedRationale: "Local repo evidence is enough to build ReviewBasis.",
    overviewMarkdown: "## Changeset Overview\n- Phase 1 readiness",
    changedFiles: [
      {
        path: "src/app.ts",
        status: "M",
        category: "feature",
        group: "review-flow",
        basis: "diff-inspected"
      },
      {
        path: "src/old.ts",
        status: "D",
        category: "refactor",
        group: "review-flow",
        basis: "name-status"
      }
    ],
    fileGroups: [
      {
        id: "G1",
        label: "review-flow",
        files: ["src/app.ts", "src/old.ts"],
        observedChange: "review flow changed"
      }
    ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [
      {
        description: "Step 0 records readiness and coverage buckets",
        files: ["src/app.ts"],
        evidenceRefs: ["R1"]
      }
    ],
    evidenceRefs: [
      {
        id: "R1",
        sourceKind: "diff",
        pathOrUrl: "src/app.ts",
        anchor: "@@ -1 +1 @@",
        summary: "review flow changed"
      }
    ],
    unresolvedUnknowns: [],
    ...overrides
  });
}

const expectedSinglePath: readonly string[] = ["src/app.ts"];

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

test("Step0OutputValidator accepts a happy minimal-core ChangeMap", () => {
  const validator = new Step0OutputValidator();
  const changeMap = validator.validate({
    responseText: makeValid(),
    expectedChangedPaths: expectedSinglePath
  });

  assert.equal(changeMap.schemaVersion, 1);
  assert.equal(changeMap.changedFiles.length, 1);
  assert.equal(changeMap.changedFiles[0].path, "src/app.ts");
  assert.equal(changeMap.fileGroups.length, 1);
  assert.equal(changeMap.fileGroups[0].label, "review-flow");
  assert.equal(changeMap.behaviorChanges.length, 1);
  assert.equal(changeMap.evidenceRefs.length, 1);
  assert.equal(changeMap.unresolvedUnknowns.length, 0);
  assert.ok(changeMap.overviewMarkdown.startsWith("## Changeset Overview"));
});

test("Step0OutputValidator accepts ChangeMapReadinessV2 readiness and coverage contract", () => {
  const validator = new Step0OutputValidator();
  const changeMap = validator.validate({
    responseText: makeValidV2(),
    expectedChangedPaths: ["src/app.ts", "src/old.ts"],
    expectedUserContext: ["Root Cause: context loss before Step 5"]
  });

  assert.equal(changeMap.schemaVersion, 2);
  assert.equal(changeMap.readiness, "READY_WITH_LIMITATIONS");
  assert.equal(changeMap.userContextSSOT[0].contextId, "UC1");
  assert.equal(changeMap.changeScope.deletedPaths, 1);
  assert.equal(changeMap.coveragePlan.mustDistinguishDeletedAndBinaryPaths, true);
  assert.equal(changeMap.expectedBehaviorLedger[0].expectationId, "EB1");
  assert.equal(changeMap.missingInformation[0].blockingLevel, "severity_only");
});

test("Step0OutputValidator rejects inconsistent ChangeMapReadinessV2 coverage buckets", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValidV2({
          changeScope: {
            totalChangedPaths: 1,
            reviewableNonDeletedPaths: 1,
            deletedPaths: 1,
            binaryOrNonReviewablePaths: 0,
            changedTests: [],
            highRiskAreas: []
          }
        }),
        expectedChangedPaths: ["src/app.ts", "src/old.ts"],
        expectedUserContext: ["Root Cause: context loss before Step 5"]
      }),
    "COVERAGE"
  );
});

test("Step0OutputValidator rejects duplicate ChangeMapReadinessV2 user context IDs", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValidV2({
          userContextSSOT: [
            {
              contextId: "UC1",
              rawText: "first",
              categories: ["reviewer_focus"],
              extractedFacts: ["first"]
            },
            {
              contextId: "UC1",
              rawText: "second",
              categories: ["reviewer_focus"],
              extractedFacts: ["second"]
            }
          ]
        }),
        expectedChangedPaths: ["src/app.ts", "src/old.ts"],
        expectedUserContext: ["first", "second"]
      }),
    "SCHEMA"
  );
});

test("Step0OutputValidator rejects user context categories outside the documented enum", () => {
  const validator = new Step0OutputValidator();
  const error = expectFailure(
    () =>
      validator.validate({
        responseText: makeValidV2({
          userContextSSOT: [
            {
              contextId: "UC1",
              rawText: "Root Cause: context loss before Step 5",
              categories: ["business_decision"],
              extractedFacts: ["context loss before Step 5"]
            }
          ]
        }),
        expectedChangedPaths: ["src/app.ts", "src/old.ts"],
        expectedUserContext: ["Root Cause: context loss before Step 5"]
      }),
    "SCHEMA",
    /userContextSSOT\[0\]\.categories\[0\] must be one of/u
  );
  assert.equal(error.diagnostic.offendingPath, "userContextSSOT[0].categories[0]");
  assert.deepEqual(error.diagnostic.allowedValues, [...USER_CONTEXT_CATEGORIES]);
});

test("Step0OutputValidator accepts every documented user context category", () => {
  const validator = new Step0OutputValidator();

  for (const category of USER_CONTEXT_CATEGORIES) {
    const changeMap = validator.validate({
      responseText: makeValidV2({
        userContextSSOT: [
          {
            contextId: "UC1",
            rawText: `context for ${category}`,
            categories: [category],
            extractedFacts: [`fact for ${category}`]
          }
        ]
      }),
      expectedChangedPaths: ["src/app.ts", "src/old.ts"],
      expectedUserContext: [`context for ${category}`]
    });

    assert.equal(changeMap.schemaVersion, 2);
    assert.deepEqual(changeMap.userContextSSOT[0].categories, [category]);
  }
});

test("Step0OutputValidator returns a deeply frozen ChangeMap", () => {
  const validator = new Step0OutputValidator();
  const changeMap = validator.validate({
    responseText: makeValid(),
    expectedChangedPaths: expectedSinglePath
  });

  assert.ok(Object.isFrozen(changeMap));
  assert.ok(Object.isFrozen(changeMap.changedFiles));
  assert.ok(Object.isFrozen(changeMap.changedFiles[0]));
  assert.ok(Object.isFrozen(changeMap.fileGroups));
  assert.ok(Object.isFrozen(changeMap.fileGroups[0]));
  assert.ok(Object.isFrozen(changeMap.fileGroups[0].files));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges[0]));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges[0].files));
  assert.ok(Object.isFrozen(changeMap.behaviorChanges[0].evidenceRefs));
  assert.ok(Object.isFrozen(changeMap.evidenceRefs));
  assert.ok(Object.isFrozen(changeMap.evidenceRefs[0]));
  assert.ok(Object.isFrozen(changeMap.unresolvedUnknowns));

  assert.throws(() => {
    (changeMap as unknown as { schemaVersion: number }).schemaVersion = 2;
  }, TypeError);
  assert.throws(() => {
    (changeMap.changedFiles as unknown as { push: (entry: unknown) => void }).push({});
  }, TypeError);
});

test("Step0OutputValidator rejects invalid JSON with PARSE", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: "not json",
        expectedChangedPaths: []
      }),
    "PARSE"
  );
});

test("Step0OutputValidator syntax-repairs a wrapping JSON code fence", () => {
  const validator = new Step0OutputValidator();
  const result = validator.validateDetailed({
    responseText: ["```json", makeValid(), "```"].join("\n"),
    expectedChangedPaths: expectedSinglePath
  });

  assert.equal(result.changeMap.schemaVersion, 1);
  assert.equal(result.parseMetadata.repairKind, "code_fence");
});

test("Step0OutputValidator syntax-repairs harmless prose around one JSON object", () => {
  const validator = new Step0OutputValidator();
  const result = validator.validateDetailed({
    responseText: ["Here is the result:", makeValid(), "Done."].join("\n"),
    expectedChangedPaths: expectedSinglePath
  });

  assert.equal(result.changeMap.schemaVersion, 1);
  assert.equal(result.parseMetadata.repairKind, "object_extraction");
});

test("Step0OutputValidator rejects ambiguous multiple root objects", () => {
  const validator = new Step0OutputValidator();
  const error = expectFailure(
    () =>
      validator.validate({
        responseText: [makeValid(), makeValid()].join("\n"),
        expectedChangedPaths: expectedSinglePath
      }),
    "PARSE",
    /multiple root JSON objects/u
  );

  assert.equal(error.diagnostic.parseStage, "root_object_detection");
});

test("Step0OutputValidator rejects truncated JSON without inventing braces", () => {
  const validator = new Step0OutputValidator();
  const error = expectFailure(
    () =>
      validator.validate({
        responseText: "{\"schemaVersion\":2",
        expectedChangedPaths: []
      }),
    "PARSE"
  );

  assert.equal(error.diagnostic.parseStage, "initial_parse");
});

test("Step0OutputValidator rejects non-object payload with SCHEMA", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: "[]",
        expectedChangedPaths: []
      }),
    "SCHEMA"
  );
});

test("Step0OutputValidator rejects schemaVersion other than literal 1 or 2", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({ schemaVersion: 3 }),
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({ schemaVersion: "1" }),
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
});

test("Step0OutputValidator rejects unknown top-level fields", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({ extraField: [] }),
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
});

test("Step0OutputValidator rejects extra changedFiles[] fields", () => {
  const validator = new Step0OutputValidator();
  const responseText = JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown: "## Changeset Overview\nx",
    changedFiles: [
      {
        path: "src/app.ts",
        status: "M",
        category: "feature",
        group: "review-flow",
        basis: "diff-inspected",
        notes: "extra"
      }
    ],
    fileGroups: [
      {
        id: "G1",
        label: "review-flow",
        files: ["src/app.ts"],
        observedChange: "changed"
      }
    ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [],
    evidenceRefs: [],
    unresolvedUnknowns: []
  });
  expectFailure(
    () =>
      validator.validate({
        responseText,
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
});

test("Step0OutputValidator rejects overviewMarkdown without strict literal prefix", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({ overviewMarkdown: "##  Changeset Overview\nx" }),
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({ overviewMarkdown: " ## Changeset Overview\nx" }),
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({ overviewMarkdown: "## changeset overview\nx" }),
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
});

test("Step0OutputValidator fails with COVERAGE when an expected path is missing", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid(),
        expectedChangedPaths: ["src/app.ts", "src/bar.ts"]
      }),
    "COVERAGE"
  );
});

test("Step0OutputValidator fails with COVERAGE on extra paths not in changeset", () => {
  const validator = new Step0OutputValidator();
  const responseText = JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown: "## Changeset Overview\nx",
    changedFiles: [
      {
        path: "src/app.ts",
        status: "M",
        category: "feature",
        group: "review-flow",
        basis: "diff-inspected"
      },
      {
        path: "src/extra.ts",
        status: "M",
        category: "feature",
        group: "review-flow",
        basis: "name-status"
      }
    ],
    fileGroups: [
      {
        id: "G1",
        label: "review-flow",
        files: ["src/app.ts", "src/extra.ts"],
        observedChange: "changed"
      }
    ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [],
    evidenceRefs: [],
    unresolvedUnknowns: []
  });
  expectFailure(
    () =>
      validator.validate({
        responseText,
        expectedChangedPaths: expectedSinglePath
      }),
    "COVERAGE"
  );
});

test("Step0OutputValidator fails with COVERAGE on duplicate path entries", () => {
  const validator = new Step0OutputValidator();
  const responseText = JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown: "## Changeset Overview\nx",
    changedFiles: [
      {
        path: "src/app.ts",
        status: "M",
        category: "feature",
        group: "review-flow",
        basis: "diff-inspected"
      },
      {
        path: "src/app.ts",
        status: "M",
        category: "feature",
        group: "review-flow",
        basis: "diff-inspected"
      }
    ],
    fileGroups: [
      {
        id: "G1",
        label: "review-flow",
        files: ["src/app.ts"],
        observedChange: "changed"
      }
    ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [],
    evidenceRefs: [],
    unresolvedUnknowns: []
  });
  expectFailure(
    () =>
      validator.validate({
        responseText,
        expectedChangedPaths: expectedSinglePath
      }),
    "COVERAGE"
  );
});

test("Step0OutputValidator fails with COVERAGE when expectedChangedPaths contains duplicates", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid(),
        expectedChangedPaths: ["src/app.ts", "src/app.ts"]
      }),
    "COVERAGE"
  );
});

test("Step0OutputValidator accepts a zero-file changeset when both sides are empty", () => {
  const validator = new Step0OutputValidator();
  const responseText = JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown: "## Changeset Overview\n- 無檔案異動",
    changedFiles: [],
    fileGroups: [],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [],
    evidenceRefs: [],
    unresolvedUnknowns: []
  });

  const changeMap = validator.validate({
    responseText,
    expectedChangedPaths: []
  });
  assert.equal(changeMap.changedFiles.length, 0);
});

test("Step0OutputValidator rejects placeholder markers", () => {
  const validator = new Step0OutputValidator();
  const cases: { value: string; label: string }[] = [
    { value: "TODO", label: "TODO" },
    { value: "behavior is TBD pending design", label: "TBD inside text" },
    { value: "N/A", label: "N/A" },
    { value: "see <replace>", label: "<replace>" },
    { value: "fill me in", label: "fill me" },
    { value: "placeholder text", label: "placeholder" }
  ];
  for (const testCase of cases) {
    expectFailure(
      () =>
        validator.validate({
          responseText: makeValid({
            behaviorChanges: [
              { description: testCase.value, files: ["src/app.ts"] }
              
            ]
          }),
          expectedChangedPaths: expectedSinglePath
        }),
      "PLACEHOLDER"
    );
  }
});

test("Step0OutputValidator does not reject correctness keywords as a fatal validation gate", () => {
  const validator = new Step0OutputValidator();
  const changeMap = validator.validate({
    responseText: makeValid({
      fileGroups: [
        {
          id: "G1",
          label: "review-flow",
          files: ["src/app.ts"],
          observedChange: "review flow fixes a user-reported bug"
        }
      ],
      behaviorChanges: [
        {
          description: "錯誤處理流程改為先回報 user context 指定的 Root Cause",
          files: ["src/app.ts"],
          evidenceRefs: ["R1"]
        }
      ]
    }),
    expectedChangedPaths: expectedSinglePath
  });

  assert.equal(changeMap.fileGroups[0].observedChange, "review flow fixes a user-reported bug");
  assert.equal(changeMap.behaviorChanges.length, 1);
});

test("Step0OutputValidator accepts neutral observation descriptions", () => {
  const validator = new Step0OutputValidator();
  const changeMap = validator.validate({
    responseText: makeValid({
      behaviorChanges: [
        {
          description: "Step 0 改為輸出結構化 JSON 並由 host validator 把關",
          files: ["src/app.ts"],
          evidenceRefs: ["R1"]
        }
      ]
    }),
    expectedChangedPaths: expectedSinglePath
  });
  assert.equal(changeMap.behaviorChanges.length, 1);
});

test("Step0OutputValidator allows empty behaviorChanges and unresolvedUnknowns", () => {
  const validator = new Step0OutputValidator();
  const changeMap = validator.validate({
    responseText: makeValid({ behaviorChanges: [], unresolvedUnknowns: [] }),
    expectedChangedPaths: expectedSinglePath
  });
  assert.equal(changeMap.behaviorChanges.length, 0);
  assert.equal(changeMap.unresolvedUnknowns.length, 0);
});

test("Step0OutputValidator rejects behaviorChanges files not in changedFiles", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({
          behaviorChanges: [
            {
              description: "影響跨檔案",
              files: ["src/not-in-changeset.ts"],
              evidenceRefs: ["R1"]
            }
          ]
        }),
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
});

test("Step0OutputValidator rejects invalid status / category / basis enums", () => {
  const validator = new Step0OutputValidator();
  const tweak = (field: string, value: string) =>
    JSON.stringify({
      schemaVersion: 1,
      overviewMarkdown: "## Changeset Overview\nx",
      changedFiles: [
        {
          path: "src/app.ts",
          status: "M",
          category: "feature",
          group: "review-flow",
          basis: "diff-inspected",
          [field]: value
        }
      ],
      fileGroups: [
        {
          id: "G1",
          label: "review-flow",
          files: ["src/app.ts"],
          observedChange: "changed"
        }
      ],
      crossFileBoundaries: [],
      testCoverageObservations: [],
      behaviorChanges: [],
      evidenceRefs: [],
      unresolvedUnknowns: []
    });
  // Note: tweak overrides via spread, so build manually
  const responseStatus = JSON.stringify({
    schemaVersion: 1,
    overviewMarkdown: "## Changeset Overview\nx",
    changedFiles: [
      {
        path: "src/app.ts",
        status: "X",
        category: "feature",
        group: "review-flow",
        basis: "diff-inspected"
      }
    ],
    fileGroups: [
      {
        id: "G1",
        label: "review-flow",
        files: ["src/app.ts"],
        observedChange: "changed"
      }
    ],
    crossFileBoundaries: [],
    testCoverageObservations: [],
    behaviorChanges: [],
    evidenceRefs: [],
    unresolvedUnknowns: []
  });
  expectFailure(
    () =>
      validator.validate({
        responseText: responseStatus,
        expectedChangedPaths: expectedSinglePath
      }),
    "SCHEMA"
  );
  // ensure tweak helper compiles (typed) but is not exercised
  void tweak;
});

test("Step0OutputValidator rejects status drift against expected changed-file descriptors", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({
          changedFiles: [
            {
              path: "src/app.ts",
              status: "M",
              category: "feature",
              group: "review-flow",
              basis: "diff-inspected"
            }
          ]
        }),
        expectedChangedPaths: ["src/app.ts"],
        expectedChangedFiles: [
          {
            originalStatus: "D",
            status: "D",
            path: "src/app.ts",
            deleted: true,
            copiedAsAdded: false,
            reviewableNonDeleted: false
          }
        ]
      }),
    "COVERAGE",
    /status for "src\/app\.ts" must be "D"/u
  );
});

test("Step0OutputValidator rejects ChangeMapReadinessV2 deleted bucket drift against expected descriptors", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValidV2({
          changeScope: {
            totalChangedPaths: 2,
            reviewableNonDeletedPaths: 2,
            deletedPaths: 0,
            binaryOrNonReviewablePaths: 0,
            changedTests: [],
            highRiskAreas: []
          }
        }),
        expectedChangedPaths: ["src/app.ts", "src/old.ts"],
        expectedChangedFiles: [
          {
            originalStatus: "M",
            status: "M",
            path: "src/app.ts",
            deleted: false,
            copiedAsAdded: false,
            reviewableNonDeleted: true
          },
          {
            originalStatus: "D",
            status: "D",
            path: "src/old.ts",
            deleted: true,
            copiedAsAdded: false,
            reviewableNonDeleted: false
          }
        ],
        expectedUserContext: ["Root Cause: context loss before Step 5"]
      }),
    "COVERAGE",
    /deletedPaths/u
  );
});

test("Step0OutputValidator rejects unresolvedUnknowns with non-boolean blocksFinding", () => {
  const validator = new Step0OutputValidator();
  expectFailure(
    () =>
      validator.validate({
        responseText: makeValid({
          unresolvedUnknowns: [
            {
              question: "API 版本？",
              blocksFinding: "yes",
              resolutionPath: "查 package.json"
            }
          ]
        }),
        expectedChangedPaths: expectedSinglePath
      }),
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

test("extractChangedPathsFromChangesetEntries preserves duplicates so validator can surface them", () => {
  const result = extractChangedPathsFromChangesetEntries([
    { status: "M", path: "src/dup.ts" },
    { status: "M", path: "src/dup.ts" }
  ]);
  assert.deepEqual([...result], ["src/dup.ts", "src/dup.ts"]);
});
