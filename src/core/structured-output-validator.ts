import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type ConfidenceThresholds
} from "./confidence-thresholds.ts";
import type {
  Finding,
  FindingTraceability
} from "./file-review-context.ts";

export interface FindingsPayload {
  findings: Finding[];
}

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
    validatorId: "findings-json";
    responseText: string;
    diffContent?: string;
  }): FindingsPayload {
    if (input.validatorId !== "findings-json") {
      throw new Error("deterministic validation failed");
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(input.responseText);
    } catch {
      throw new Error("deterministic validation failed");
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("findings" in parsed)
    ) {
      throw new Error("deterministic validation failed");
    }

    const findings = (parsed as { findings: unknown }).findings;

    if (!Array.isArray(findings)) {
      throw new Error("deterministic validation failed");
    }

    const hunkHeaders = collectUnifiedDiffHunkHeaders(input.diffContent);
    const validatedFindings = findings.map((finding) =>
      validateFinding(finding, hunkHeaders)
    );

    // Validation happens first; threshold filtering trims low-confidence findings after the payload is structurally sound.
    return {
      findings: validatedFindings.filter((finding) =>
        finding.type === "must"
          ? finding.confidence >= this.#confidenceThresholds.must
          : finding.confidence >= this.#confidenceThresholds.nice
      )
    };
  }
}

function validateFinding(
  input: unknown,
  hunkHeaders: Set<string>
): Finding {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("deterministic validation failed");
  }

  const finding = input as Record<string, unknown>;
  const type = validateStringField(finding.type);
  const title = validateStringField(finding.title);
  const traceability = validateTraceability(finding.traceability, hunkHeaders);
  const context = validateStringField(finding.context);
  const deviation = validateStringField(finding.deviation);
  const impact = validateStringField(finding.impact);
  const suggestion = validateStringField(finding.suggestion);
  const confidence = finding.confidence;

  if (type !== "must" && type !== "nice") {
    throw new Error("deterministic validation failed");
  }

  if (
    typeof confidence !== "number" ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 100
  ) {
    throw new Error("deterministic validation failed");
  }

  return {
    type,
    title,
    traceability,
    context,
    deviation,
    impact,
    suggestion,
    confidence
  };
}

function validateTraceability(
  input: unknown,
  hunkHeaders: Set<string>
): FindingTraceability {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("deterministic validation failed");
  }

  const traceability = input as Record<string, unknown>;
  const kind = validateStringField(traceability.kind);

  if (kind === "line-range") {
    const lineStart = validatePositiveInteger(traceability.lineStart);
    const lineEnd = validatePositiveInteger(traceability.lineEnd);

    if (lineEnd < lineStart) {
      throw new Error("deterministic validation failed");
    }

    return {
      kind,
      lineStart,
      lineEnd
    };
  }

  if (kind === "diff-hunk") {
    const hunkHeader = validateStringField(traceability.hunkHeader);

    if (!hunkHeaders.has(hunkHeader)) {
      throw new Error("deterministic validation failed");
    }

    return {
      kind,
      hunkHeader
    };
  }

  throw new Error("deterministic validation failed");
}

function validatePositiveInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error("deterministic validation failed");
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

function validateStringField(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("deterministic validation failed");
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("deterministic validation failed");
  }

  return trimmed;
}
