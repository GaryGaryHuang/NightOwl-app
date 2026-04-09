export interface ToolPolicyDecisionDeny {
  permissionDecision: "deny";
  permissionDecisionReason: string;
}

export type ToolPolicyDecision = ToolPolicyDecisionDeny | undefined;
