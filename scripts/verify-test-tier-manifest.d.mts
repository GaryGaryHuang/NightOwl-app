export declare const CANONICAL_TIERS: readonly ["unit", "integration", "e2e"];

type ScriptLogger = {
  log(message: string): void;
  error(message: string): void;
};

type TestTierManifest = {
  unit: string[];
  integration: string[];
  e2e: string[];
};

export interface TestTierManifestEvaluationResult {
  tierLists: TestTierManifest;
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
  logger?: ScriptLogger;
}): TestTierManifest;
