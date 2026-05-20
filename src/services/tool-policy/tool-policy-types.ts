export interface ToolPolicyBoundaryContext {
  repoRoot: string;
  reviewOutputRoot?: string;
}

export interface ToolPolicyDecisionDeny {
  permissionDecision: "deny";
  permissionDecisionReason: string;
}

export type ToolPolicyDecision = ToolPolicyDecisionDeny | undefined;
