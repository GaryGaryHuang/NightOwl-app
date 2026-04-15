export declare const CANONICAL_TIERS: readonly string[];

export interface TestTierManifestEvaluationResult {
  tierLists: Record<string, string[]>;
  allSchemaViolations: string[];
  sortOrderViolations: string[];
  pathFormatViolations: string[];
  duplicates: string[];
  missingFromManifest: string[];
  staleInManifest: string[];
  hasErrors: boolean;
  diskFileCount: number;
}

export declare class ManifestVerificationError extends Error {
  constructor(message?: string);
}

export declare function evaluateTestTierManifest(input: {
  manifest: unknown;
  parseViolations?: string[];
  diskFiles: string[];
}): TestTierManifestEvaluationResult;

export declare function loadVerifiedTestTierManifest(options?: {
  logger?: { log(message: string): void; error(message: string): void };
}): Record<string, string[]>;
