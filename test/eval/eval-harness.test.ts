import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import type { VerifierReportEntry } from "../../src/core/verifier-report.ts";

// --- Corpus types ---

interface CorpusCase {
  caseId: string;
  caseType:
    | "known-true-positive"
    | "no-finding-safe-change"
    | "speculative-false-positive"
    | "wrong-anchor"
    | "prompt-injection";
  description: string;
  input: {
    findingsJson: string;
    diffContent: string;
    filePath: string;
  };
  expected: {
    acceptedFindingIds: string[];
    rejectedFindingIds: string[];
    taxonomyCodes: Record<string, string>;
  };
}

// --- Corpus loader ---

function loadCorpus(): CorpusCase[] {
  const corpusPath = path.resolve(
    import.meta.dirname,
    "corpus.jsonl"
  );
  const content = readFileSync(corpusPath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as CorpusCase;
      } catch {
        throw new Error(`Failed to parse corpus line ${index + 1}`);
      }
    });
}

// --- Eval runner ---

interface CaseResult {
  caseId: string;
  caseType: CorpusCase["caseType"];
  acceptedFindingIds: string[];
  rejectedFindingIds: string[];
  report: VerifierReportEntry[];
  passed: boolean;
  errors: string[];
}

function runCase(c: CorpusCase): CaseResult {
  const validator = new StructuredOutputValidator();
  const errors: string[] = [];
  let acceptedFindingIds: string[] = [];
  let rejectedFindingIds: string[] = [];
  let report: VerifierReportEntry[] = [];

  try {
    const { payload: schemaPayload, report: schemaReport } =
      validator.validateWithReport({
        responseText: c.input.findingsJson,
        diffContent: c.input.diffContent,
        filePath: c.input.filePath
      });

    const { payload: acceptedPayload, report: acceptanceReport } =
      validator.filterByAcceptanceWithReport(schemaPayload);

    report = [...schemaReport, ...acceptanceReport];
    acceptedFindingIds = acceptedPayload.findings.map((f) => f.findingId);

    // Rejected = appeared in schema pass but not in acceptance pass
    const acceptedSet = new Set(acceptedFindingIds);
    rejectedFindingIds = schemaPayload.findings
      .filter((f) => !acceptedSet.has(f.findingId))
      .map((f) => f.findingId);
  } catch (err) {
    // Schema/anchor validation threw — all findings are rejected
    const message = err instanceof Error ? err.message : String(err);

    // Try to extract findingIds from the input JSON for tracking
    try {
      const parsed = JSON.parse(c.input.findingsJson) as {
        findings?: Array<{ findingId?: string }>;
      };
      if (Array.isArray(parsed.findings)) {
        rejectedFindingIds = parsed.findings
          .map((f) => f.findingId ?? "unknown")
          .filter((id) => id !== "unknown");
      }
    } catch {
      // Can't parse input — that's expected for PARSE test cases
    }

    // Determine taxonomy from error message
    let taxonomy: string = "SCHEMA";
    if (message.includes("[ANCHOR]")) {
      taxonomy = "ANCHOR";
    } else if (message.includes("not valid JSON")) {
      taxonomy = "PARSE";
    }

    for (const id of rejectedFindingIds) {
      report.push({
        findingId: id,
        taxonomy: taxonomy as VerifierReportEntry["taxonomy"],
        outcome: "rejected",
        gate: taxonomy === "ANCHOR" ? "anchor" : "schema",
        reason: message
      });
    }
  }

  // Verify accepted finding IDs match expected
  const expectedAccepted = new Set(c.expected.acceptedFindingIds);
  const actualAccepted = new Set(acceptedFindingIds);
  for (const id of expectedAccepted) {
    if (!actualAccepted.has(id)) {
      errors.push(`Expected finding '${id}' to be accepted but it was not`);
    }
  }
  for (const id of actualAccepted) {
    if (!expectedAccepted.has(id)) {
      errors.push(`Finding '${id}' was accepted but not expected`);
    }
  }

  // Verify rejected finding IDs match expected
  const expectedRejected = new Set(c.expected.rejectedFindingIds);
  const actualRejected = new Set(rejectedFindingIds);
  for (const id of expectedRejected) {
    if (!actualRejected.has(id)) {
      errors.push(`Expected finding '${id}' to be rejected but it was not`);
    }
  }

  // Verify taxonomy codes
  for (const [findingId, expectedTaxonomy] of Object.entries(
    c.expected.taxonomyCodes
  )) {
    // Find the most specific (latest) report entry for this finding
    const entries = report.filter((e) => e.findingId === findingId);
    const lastEntry = entries[entries.length - 1];
    if (!lastEntry) {
      errors.push(
        `No report entry for finding '${findingId}' to check taxonomy`
      );
    } else if (lastEntry.taxonomy !== expectedTaxonomy) {
      errors.push(
        `Finding '${findingId}': expected taxonomy '${expectedTaxonomy}' but got '${lastEntry.taxonomy}'`
      );
    }
  }

  return {
    caseId: c.caseId,
    caseType: c.caseType,
    acceptedFindingIds,
    rejectedFindingIds,
    report,
    passed: errors.length === 0,
    errors
  };
}

// --- Metrics ---

interface EvalMetrics {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  acceptedFalsePositives: number;
  rejectedTruePositives: number;
  wrongAnchorAccepted: number;
}

const FALSE_POSITIVE_CASE_TYPES: ReadonlySet<string> = new Set([
  "no-finding-safe-change",
  "speculative-false-positive",
  "wrong-anchor",
  "prompt-injection"
]);

function computeMetrics(
  corpus: CorpusCase[],
  results: CaseResult[]
): EvalMetrics {
  let acceptedFalsePositives = 0;
  let rejectedTruePositives = 0;
  let wrongAnchorAccepted = 0;

  for (const result of results) {
    if (
      FALSE_POSITIVE_CASE_TYPES.has(result.caseType) &&
      result.acceptedFindingIds.length > 0
    ) {
      acceptedFalsePositives += 1;
    }

    if (result.caseType === "known-true-positive") {
      const c = corpus.find((c) => c.caseId === result.caseId)!;
      const expectedAccepted = new Set(c.expected.acceptedFindingIds);
      for (const id of expectedAccepted) {
        if (!result.acceptedFindingIds.includes(id)) {
          rejectedTruePositives += 1;
        }
      }
    }

    if (
      result.caseType === "wrong-anchor" &&
      result.acceptedFindingIds.length > 0
    ) {
      wrongAnchorAccepted += 1;
    }
  }

  return {
    totalCases: results.length,
    passedCases: results.filter((r) => r.passed).length,
    failedCases: results.filter((r) => !r.passed).length,
    acceptedFalsePositives,
    rejectedTruePositives,
    wrongAnchorAccepted
  };
}

// --- Tests ---

describe("Eval Harness", () => {
  const corpus = loadCorpus();
  const results = corpus.map(runCase);
  const metrics = computeMetrics(corpus, results);

  // --- Corpus structure ---

  it("EVAL-STRUCT-1 corpus has at least 10 cases", () => {
    assert.ok(corpus.length >= 10, `expected >= 10 cases, got ${corpus.length}`);
  });

  it("EVAL-STRUCT-2 corpus covers all 5 case types", () => {
    const types = new Set(corpus.map((c) => c.caseType));
    for (const expected of [
      "known-true-positive",
      "no-finding-safe-change",
      "speculative-false-positive",
      "wrong-anchor",
      "prompt-injection"
    ]) {
      assert.ok(types.has(expected as CorpusCase["caseType"]), `missing caseType: ${expected}`);
    }
  });

  // --- Per-case assertions ---

  for (const result of results) {
    it(`EVAL-CASE ${result.caseId}: ${result.caseType}`, () => {
      if (!result.passed) {
        assert.fail(
          `Case ${result.caseId} failed:\n${result.errors.join("\n")}`
        );
      }
    });
  }

  // --- Release gates ---

  it("GATE-1 acceptedFalsePositives === 0", () => {
    assert.equal(
      metrics.acceptedFalsePositives,
      0,
      `Expected 0 accepted false positives, got ${metrics.acceptedFalsePositives}`
    );
  });

  it("GATE-2 rejectedTruePositives <= 1", () => {
    assert.ok(
      metrics.rejectedTruePositives <= 1,
      `Expected <= 1 rejected true positives, got ${metrics.rejectedTruePositives}`
    );
  });

  it("GATE-3 wrongAnchorAccepted === 0", () => {
    assert.equal(
      metrics.wrongAnchorAccepted,
      0,
      `Expected 0 wrong-anchor accepted, got ${metrics.wrongAnchorAccepted}`
    );
  });
});
