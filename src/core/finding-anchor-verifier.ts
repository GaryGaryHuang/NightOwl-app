/**
 * FindingAnchorVerifier — pure verifier that checks whether a finding's
 * traceability anchor is supported by the per-file diff anchor map.
 *
 * Returns an `ANCHOR`-tagged failure verdict when the anchor cannot be
 * supported (and no dependency-path exception is supplied).
 *
 * No I/O. No mutation of inputs. No semantic validation of
 * `dependencyPathException` content (that belongs to later milestones).
 */

import type {
  DependencyPathException,
  FindingTraceability
} from "./file-review-context.ts";
import type { FindingAnchorValidationContext } from "./finding-anchor-context.ts";

export const ANCHOR_FAILURE_TAG = "ANCHOR" as const;

export type AnchorFailureReason =
  | "unknown-hunk-header"
  | "line-range-outside-changed-lines";

export interface AnchorVerificationOk {
  readonly ok: true;
}

export interface AnchorVerificationFailure {
  readonly ok: false;
  readonly tag: typeof ANCHOR_FAILURE_TAG;
  readonly reason: AnchorFailureReason;
  readonly detail: string;
}

export type AnchorVerificationResult =
  | AnchorVerificationOk
  | AnchorVerificationFailure;

export interface VerifyFindingAnchorInput {
  readonly traceability: FindingTraceability;
  readonly anchorContext: FindingAnchorValidationContext;
  readonly dependencyPathException?: DependencyPathException | undefined;
}

export function verifyFindingAnchor(
  input: VerifyFindingAnchorInput
): AnchorVerificationResult {
  const { traceability, anchorContext, dependencyPathException } = input;
  const { diffAnchorMap } = anchorContext;

  if (traceability.kind === "diff-hunk") {
    const known = diffAnchorMap.hunks.some(
      (hunk) => hunk.hunkHeader === traceability.hunkHeader.trim()
    );

    if (known) {
      return { ok: true };
    }

    return {
      ok: false,
      tag: ANCHOR_FAILURE_TAG,
      reason: "unknown-hunk-header",
      detail: `hunk header '${traceability.hunkHeader}' not found in diff for ${anchorContext.filePath}`
    };
  }

  // line-range path
  const overlaps = diffAnchorMap.hunks.some((hunk) => {
    for (const changedLine of hunk.changedHeadLines) {
      if (
        changedLine >= traceability.lineStart &&
        changedLine <= traceability.lineEnd
      ) {
        return true;
      }
    }
    return false;
  });

  if (overlaps) {
    return { ok: true };
  }

  if (dependencyPathException) {
    return { ok: true };
  }

  return {
    ok: false,
    tag: ANCHOR_FAILURE_TAG,
    reason: "line-range-outside-changed-lines",
    detail: `line range ${traceability.lineStart}-${traceability.lineEnd} does not overlap any changed head-side line in the diff for ${anchorContext.filePath}`
  };
}
