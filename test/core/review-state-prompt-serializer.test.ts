import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../src/core/file-review-context.ts";
import {
  ReviewStatePromptSerializer,
  type ReviewStateBlock
} from "../../src/core/review-state-prompt-serializer.ts";

function createContext(): FileReviewContext {
  return new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/tmp/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-old\n+new\n",
    baseRef: "main",
    headRef: "feature"
  });
}

function createFinding(findingId: string, type: "must" | "nice" = "must"): Finding {
  return {
    type,
    title: `${type} finding ${findingId}`,
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
    context: "ctx",
    deviation: "dev",
    impact: "impact",
    suggestion: "suggestion",
    modelConfidence: 85,
    findingId,
    supportingEvidence: [{ source: "diff:src/app.ts:1", content: "changed" }],
    reachability: { credible: true, description: "reachable" },
    uncertaintyStatus: "supported" as const
  };
}

const serializer = new ReviewStatePromptSerializer();

// --- RSP-3: Output Wrapper ---

test("RSP-3a: empty context with sections-only produces wrapper with no content blocks", () => {
  const ctx = createContext();
  const result = serializer.serialize({ context: ctx, include: ["sections"] });

  assert.equal(result, "<review_state>\n</review_state>");
});

test("RSP-3b: non-empty context produces content between wrapper tags", () => {
  const ctx = createContext();
  ctx.setSection("overview", "## Overview\ncontent");
  const result = serializer.serialize({ context: ctx, include: ["sections"] });

  assert.match(result, /^<review_state>\n/);
  assert.match(result, /\n<\/review_state>$/);
  assert.match(result, /## Overview/);
});

// --- RSP-1: Serialize Section Entries ---

test("RSP-1a: two sections produce two labeled section blocks in insertion order", () => {
  const ctx = createContext();
  ctx.setSection("overview", "## Overview\nfirst");
  ctx.setSection("dependencies-boundaries", "## Dependencies & Boundaries\nsecond");
  const result = serializer.serialize({ context: ctx, include: ["sections"] });

  const sectionPattern = /<section key="([^"]+)">\n([\s\S]*?)\n<\/section>/g;
  const matches = [...result.matchAll(sectionPattern)];
  assert.equal(matches.length, 2);
  assert.equal(matches[0][1], "overview");
  assert.match(matches[0][2], /## Overview/);
  assert.equal(matches[1][1], "dependencies-boundaries");
  assert.match(matches[1][2], /## Dependencies & Boundaries/);

  // Insertion order: overview appears before dependencies
  const overviewIdx = result.indexOf('<section key="overview">');
  const depsIdx = result.indexOf('<section key="dependencies-boundaries">');
  assert.ok(overviewIdx < depsIdx);
});

test("RSP-1b: zero sections produces no section blocks", () => {
  const ctx = createContext();
  const result = serializer.serialize({ context: ctx, include: ["sections"] });

  assert.equal(result.includes("<section"), false);
});

test("RSP-1c: section content is preserved verbatim", () => {
  const ctx = createContext();
  const rawContent = "## Overview\n- 整體理解：test\n  - nested bullet\n\n  trailing whitespace  ";
  ctx.setSection("overview", rawContent);
  const result = serializer.serialize({ context: ctx, include: ["sections"] });

  assert.ok(result.includes(rawContent));
});

// --- RSP-2: Serialize Findings ---

test("RSP-2a: sections+findings include produces both blocks", () => {
  const ctx = createContext();
  ctx.setSection("overview", "## Overview\ncontent");
  ctx.setFindings([createFinding("F1")]);
  const result = serializer.serialize({ context: ctx, include: ["sections", "verified-findings"] });

  assert.match(result, /<section key="overview">/);
  assert.match(result, /<verified_findings format="json">/);
  assert.match(result, /<\/verified_findings>/);
});

test("RSP-2b: findings-only include produces findings block without sections", () => {
  const ctx = createContext();
  ctx.setSection("overview", "## Overview\ncontent");
  ctx.setFindings([createFinding("F1")]);
  const result = serializer.serialize({ context: ctx, include: ["verified-findings"] });

  assert.equal(result.includes("<section"), false);
  assert.match(result, /<verified_findings format="json">/);
});

test("RSP-2c: no findings set + findings include produces no findings block", () => {
  const ctx = createContext();
  const result = serializer.serialize({ context: ctx, include: ["verified-findings"] });

  assert.equal(result.includes("<verified_findings"), false);
});

test("RSP-2d: empty findings array + findings include produces findings block with empty array", () => {
  const ctx = createContext();
  ctx.setFindings([]);
  const result = serializer.serialize({ context: ctx, include: ["verified-findings"] });

  assert.match(result, /<verified_findings format="json">/);
  const findingsMatch = result.match(/<verified_findings format="json">\n([\s\S]*?)\n<\/verified_findings>/);
  assert.ok(findingsMatch);
  const parsed = JSON.parse(findingsMatch![1]);
  assert.deepEqual(parsed, []);
});

test("RSP-2e: finding JSON preserves all v2 typed fields", () => {
  const ctx = createContext();
  const finding = createFinding("F1");
  finding.sourceHypothesisId = "W1";
  finding.dependencyPathException = {
    reason: "transitive dependency",
    dependencyAnchor: { filePath: "src/dep.ts", symbol: "helper" }
  };
  ctx.setFindings([finding]);
  const result = serializer.serialize({ context: ctx, include: ["verified-findings"] });

  const findingsMatch = result.match(/<verified_findings format="json">\n([\s\S]*?)\n<\/verified_findings>/);
  assert.ok(findingsMatch);
  const parsed = JSON.parse(findingsMatch![1]);
  assert.equal(parsed.length, 1);
  const f = parsed[0];
  assert.equal(f.findingId, "F1");
  assert.equal(f.uncertaintyStatus, "supported");
  assert.equal(f.reachability.credible, true);
  assert.equal(f.supportingEvidence[0].source, "diff:src/app.ts:1");
  assert.equal(f.sourceHypothesisId, "W1");
  assert.equal(f.dependencyPathException.reason, "transitive dependency");
  assert.equal(f.dependencyPathException.dependencyAnchor.symbol, "helper");
});

// --- Sections not in include list ---

test("sections not requested means no section blocks even when context has sections", () => {
  const ctx = createContext();
  ctx.setSection("overview", "## Overview\ncontent");
  const result = serializer.serialize({ context: ctx, include: ["verified-findings"] });

  assert.equal(result.includes("<section"), false);
});

// --- Multiple findings ---

test("multiple findings serialize as JSON array", () => {
  const ctx = createContext();
  ctx.setFindings([createFinding("F1", "must"), createFinding("F2", "nice")]);
  const result = serializer.serialize({ context: ctx, include: ["verified-findings"] });

  const findingsMatch = result.match(/<verified_findings format="json">\n([\s\S]*?)\n<\/verified_findings>/);
  assert.ok(findingsMatch);
  const parsed = JSON.parse(findingsMatch![1]);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].findingId, "F1");
  assert.equal(parsed[1].findingId, "F2");
});

test("serializer can emit standalone candidate findings blocks", () => {
  const result = serializer.serializeFindingsBlock({
    kind: "candidate-findings",
    findings: [createFinding("F1")]
  });

  assert.match(result, /<candidate_findings format="json">/);
  assert.match(result, /<\/candidate_findings>/);
  const findingsMatch = result.match(/<candidate_findings format="json">\n([\s\S]*?)\n<\/candidate_findings>/);
  assert.ok(findingsMatch);
  const parsed = JSON.parse(findingsMatch![1]);
  assert.equal(parsed[0].findingId, "F1");
});
