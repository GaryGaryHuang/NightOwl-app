import assert from "node:assert/strict";
import test from "node:test";

import { buildActiveFileSummary } from "../../src/cli/progress-reporter.ts";

test("buildActiveFileSummary formats and orders active file paths", () => {
  const cases: Array<{
    name: string;
    files: Map<string, { claimOrder: number; lastProgressSeq: number }>;
    expected: string;
  }> = [
    {
      name: "empty map",
      files: new Map(),
      expected: ""
    },
    {
      name: "two entries ordered by recency",
      files: new Map([
        ["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }],
        ["src/b.ts", { claimOrder: 2, lastProgressSeq: 2 }]
      ]),
      expected: "src/b.ts, src/a.ts"
    },
    {
      name: "five entries capped at three with hidden count",
      files: new Map([
        ["src/a.ts", { claimOrder: 1, lastProgressSeq: 1 }],
        ["src/b.ts", { claimOrder: 2, lastProgressSeq: 2 }],
        ["src/c.ts", { claimOrder: 3, lastProgressSeq: 3 }],
        ["src/d.ts", { claimOrder: 4, lastProgressSeq: 4 }],
        ["src/e.ts", { claimOrder: 5, lastProgressSeq: 5 }]
      ]),
      expected: "src/e.ts, src/d.ts, src/c.ts | +2 more"
    },
    {
      name: "claim order tiebreaker",
      files: new Map([
        ["src/late-claim.ts", { claimOrder: 3, lastProgressSeq: 10 }],
        ["src/early-claim.ts", { claimOrder: 1, lastProgressSeq: 10 }]
      ]),
      expected: "src/early-claim.ts, src/late-claim.ts"
    }
  ];

  for (const { name, files, expected } of cases) {
    assert.equal(buildActiveFileSummary(files), expected, name);
  }
});
