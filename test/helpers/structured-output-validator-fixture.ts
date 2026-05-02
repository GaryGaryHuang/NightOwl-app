import assert from "node:assert/strict";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";

export const DEFAULT_HUNK_HEADER = "@@ -20,2 +20,4 @@";
export const DEFAULT_DIFF = [
  DEFAULT_HUNK_HEADER,
  " context-before",
  "+added-21",
  "+added-22",
  " context-after"
].join("\n");

export function lineRangeTraceability(lineStart: unknown, lineEnd: unknown) {
  return {
    kind: "line-range",
    lineStart,
    lineEnd
  };
}

export function diffHunkTraceability(hunkHeader: unknown) {
  return {
    kind: "diff-hunk",
    hunkHeader
  };
}

export function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "must",
    title: "問題標題",
    traceability: lineRangeTraceability(14, 18),
    expectedBehavior: "應保留原本的 null guard 行為",
    actualBehavior: "改動後會在檢查前 dereference input",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    findingId: "F1",
    supportingEvidence: [
      { evidenceRef: "E1", supports: "expectedBehavior" },
      { evidenceRef: "E2", supports: "actualBehavior" },
      { evidenceRef: "E3", supports: "reachability" },
      { evidenceRef: "E4", supports: "impact" }
    ],
    reachability: {
      credible: true,
      entryPoint: "handleRequest",
      guardsChecked: ["input is passed from the public API"]
    },
    uncertaintyStatus: "supported",
    ...overrides
  };
}

export function payload(findings: unknown[]): string {
  return JSON.stringify({ schemaVersion: 2, findings });
}

export function validate(input: {
  responseText: string;
  diffContent?: string;
}) {
  return new StructuredOutputValidator().validate({
    responseText: input.responseText,
    ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
  });
}

export function validateAndFilter(input: {
  responseText: string;
  diffContent?: string;
}) {
  const validator = new StructuredOutputValidator();
  const payload = validator.validate({
    responseText: input.responseText,
    ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
  });

  return validator.filterByAcceptance(payload);
}

export function assertValidationFails(input: {
  responseText: string;
  diffContent?: string;
  label?: string;
}): void {
  assert.throws(
    () =>
      new StructuredOutputValidator().validate({
        responseText: input.responseText,
        ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
      }),
    /deterministic validation failed/u,
    input.label
  );
}

export function disposition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    findingId: "F1",
    status: "retained",
    reason: "SUPPORTED",
    explanation: "simulation confirmed the finding",
    ...overrides
  };
}

export function acceptedVerifierVerdict(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    status: "accepted",
    checks: {
      anchor: "pass",
      evidence: "pass",
      reachability: "pass",
      impact: "pass",
      scope: "pass",
      duplicate: "pass"
    },
    ...overrides
  };
}

export function verifiedFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return finding({
    verifierVerdict: acceptedVerifierVerdict(),
    ...overrides
  });
}

export function verifiedPayload(findings: unknown[], dispositions: unknown[]): string {
  return JSON.stringify({ schemaVersion: 2, findings, dispositions });
}

export function validateWithDispositions(input: {
  responseText: string;
  diffContent?: string;
}) {
  return new StructuredOutputValidator().validateWithDispositions({
    responseText: input.responseText,
    ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
  });
}

export function assertDispositionValidationFails(input: {
  responseText: string;
  diffContent?: string;
  label?: string;
}): void {
  assert.throws(
    () =>
      new StructuredOutputValidator().validateWithDispositions({
        responseText: input.responseText,
        ...(input.diffContent === undefined ? {} : { diffContent: input.diffContent })
      }),
    /deterministic validation failed/u,
    input.label
  );
}
