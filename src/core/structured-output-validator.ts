import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type ConfidenceThresholds
} from "./confidence-thresholds.ts";
import { buildDiffAnchorMap, type DiffAnchorMap } from "./diff-anchor-map.ts";
import type {
  DependencyPathException,
  Finding,
  FindingsPayload,
  FindingTraceability
} from "./file-review-context.ts";
import {
  verifyFindingAnchor,
  type AnchorVerificationFailure
} from "./finding-anchor-verifier.ts";

export interface StructuredOutputValidatorOptions {
  confidenceThresholds?: ConfidenceThresholds;
}

/**
 * Deterministically validate structured findings JSON before it is written into review state.
 */
export class StructuredOutputValidator {
  readonly #confidenceThresholds: ConfidenceThresholds;

  constructor(options: StructuredOutputValidatorOptions = {}) {
    this.#confidenceThresholds = options.confidenceThresholds ?? {
      ...DEFAULT_CONFIDENCE_THRESHOLDS
    };
  }

  validate(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): FindingsPayload {
    let parsed: unknown;

    try {
      parsed = JSON.parse(input.responseText);
    } catch {
      throw new Error(
        "deterministic validation failed: response is not valid JSON"
      );
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("findings" in parsed)
    ) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with a 'findings' array"
      );
    }

    const findings = (parsed as { findings: unknown }).findings;

    if (!Array.isArray(findings)) {
      throw new Error(
        "deterministic validation failed: top-level payload must be an object with a 'findings' array"
      );
    }

    const diffAnchorMap =
      input.diffContent === undefined
        ? undefined
        : buildDiffAnchorMap(input.filePath ?? "<unknown>", input.diffContent);
    const hunkHeaders = collectUnifiedDiffHunkHeaders(input.diffContent);
    const validatedFindings = findings.map((finding) =>
      validateFinding(finding, hunkHeaders, diffAnchorMap)
    );

    return { findings: validatedFindings };
  }

  filterByConfidence(payload: FindingsPayload): FindingsPayload {
    return {
      findings: payload.findings.filter((finding) =>
        finding.type === "must"
          ? finding.confidence >= this.#confidenceThresholds.must
          : finding.confidence >= this.#confidenceThresholds.nice
      )
    };
  }
}

function validateFinding(
  input: unknown,
  hunkHeaders: Set<string>,
  diffAnchorMap: DiffAnchorMap | undefined
): Finding {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: each finding must be a non-null object"
    );
  }

  const finding = input as Record<string, unknown>;
  const type = validateStringField(finding.type, "type");
  const title = validateStringField(finding.title, "title");
  const dependencyPathException = validateDependencyPathException(
    finding.dependencyPathException
  );
  const traceability = validateTraceability(
    finding.traceability,
    hunkHeaders,
    diffAnchorMap,
    dependencyPathException
  );
  const context = validateStringField(finding.context, "context");
  const deviation = validateStringField(finding.deviation, "deviation");
  const impact = validateStringField(finding.impact, "impact");
  const suggestion = validateStringField(finding.suggestion, "suggestion");
  const confidence = finding.confidence;

  if (type !== "must" && type !== "nice") {
    throw new Error(
      "deterministic validation failed: 'type' must be 'must' or 'nice'"
    );
  }

  if (
    typeof confidence !== "number" ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 100
  ) {
    throw new Error(
      "deterministic validation failed: 'confidence' must be a number between 0 and 100"
    );
  }

  const result: Finding = {
    type,
    title,
    traceability,
    context,
    deviation,
    impact,
    suggestion,
    confidence
  };

  if (dependencyPathException) {
    result.dependencyPathException = dependencyPathException;
  }

  return result;
}

function validateTraceability(
  input: unknown,
  hunkHeaders: Set<string>,
  diffAnchorMap: DiffAnchorMap | undefined,
  dependencyPathException: DependencyPathException | undefined
): FindingTraceability {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: 'traceability' must be a non-null object"
    );
  }

  const traceability = input as Record<string, unknown>;
  const kind = validateStringField(traceability.kind, "traceability.kind");

  if (kind === "line-range") {
    const lineStart = validatePositiveInteger(
      traceability.lineStart,
      "traceability.lineStart"
    );
    const lineEnd = validatePositiveInteger(
      traceability.lineEnd,
      "traceability.lineEnd"
    );

    if (lineEnd < lineStart) {
      throw new Error(
        "deterministic validation failed: 'traceability.lineEnd' must be >= 'traceability.lineStart'"
      );
    }

    const resolved: FindingTraceability = {
      kind,
      lineStart,
      lineEnd
    };

    if (diffAnchorMap) {
      const verdict = verifyFindingAnchor({
        traceability: resolved,
        diffAnchorMap,
        ...(dependencyPathException === undefined
          ? {}
          : { dependencyPathException })
      });

      if (!verdict.ok) {
        throw new Error(formatAnchorFailure("traceability", verdict));
      }
    }

    return resolved;
  }

  if (kind === "diff-hunk") {
    const hunkHeader = validateStringField(
      traceability.hunkHeader,
      "traceability.hunkHeader"
    );

    const resolved: FindingTraceability = {
      kind,
      hunkHeader
    };

    if (diffAnchorMap) {
      const verdict = verifyFindingAnchor({
        traceability: resolved,
        diffAnchorMap
      });

      if (!verdict.ok) {
        throw new Error(formatAnchorFailure("traceability", verdict));
      }

      return resolved;
    }

    if (!hunkHeaders.has(hunkHeader)) {
      throw new Error(
        "deterministic validation failed: 'traceability.hunkHeader' not found in diff"
      );
    }

    return resolved;
  }

  throw new Error(
    "deterministic validation failed: unsupported traceability kind"
  );
}

function validateDependencyPathException(
  input: unknown
): DependencyPathException | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "deterministic validation failed: 'dependencyPathException' must be a non-null object"
    );
  }

  const exception = input as Record<string, unknown>;
  const reason = validateStringField(
    exception.reason,
    "dependencyPathException.reason"
  );

  const dependencyAnchor = exception.dependencyAnchor;
  if (
    !dependencyAnchor ||
    typeof dependencyAnchor !== "object" ||
    Array.isArray(dependencyAnchor)
  ) {
    throw new Error(
      "deterministic validation failed: 'dependencyPathException.dependencyAnchor' must be a non-null object"
    );
  }

  const anchor = dependencyAnchor as Record<string, unknown>;
  const filePath = validateStringField(
    anchor.filePath,
    "dependencyPathException.dependencyAnchor.filePath"
  );

  const result: DependencyPathException = {
    reason,
    dependencyAnchor: { filePath }
  };

  if (anchor.symbol !== undefined) {
    const symbol = validateStringField(
      anchor.symbol,
      "dependencyPathException.dependencyAnchor.symbol"
    );
    result.dependencyAnchor.symbol = symbol;
  }

  return result;
}

function formatAnchorFailure(
  fieldName: string,
  failure: AnchorVerificationFailure
): string {
  return `deterministic validation failed: '${fieldName}' [${failure.tag}] ${failure.detail}`;
}

function validatePositiveInteger(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a positive integer`
    );
  }

  return value;
}

function collectUnifiedDiffHunkHeaders(diffContent?: string): Set<string> {
  if (!diffContent) {
    return new Set();
  }

  return new Set(
    diffContent
      .split("\n")
      .filter((line) => /^@@ .* @@(?: .*|)$/u.test(line.trim()))
      .map((line) => line.trim())
  );
}

function validateStringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a non-empty string`
    );
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(
      `deterministic validation failed: '${fieldName}' must be a non-empty string`
    );
  }

  return trimmed;
}
