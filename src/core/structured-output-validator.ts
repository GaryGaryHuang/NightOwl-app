import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type ConfidenceThresholds
} from "./confidence-thresholds.ts";
import type { Finding } from "./file-review-context.ts";

export interface FindingsPayload {
  findings: Finding[];
}

export interface StructuredOutputValidatorOptions {
  confidenceThresholds?: ConfidenceThresholds;
}

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

    const validatedFindings = findings.map(validateFinding);

    return {
      findings: validatedFindings.filter((finding) =>
        finding.type === "must"
          ? finding.confidence >= this.#confidenceThresholds.must
          : finding.confidence >= this.#confidenceThresholds.nice
      )
    };
  }
}

function validateFinding(input: unknown): Finding {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("deterministic validation failed");
  }

  const finding = input as Record<string, unknown>;
  const type = validateStringField(finding.type);
  const title = validateStringField(finding.title);
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
    context,
    deviation,
    impact,
    suggestion,
    confidence
  };
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
