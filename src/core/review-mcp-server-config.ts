export interface ReviewLocalMcpServerConfig {
  type: "local" | "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
  cwd?: string;
  timeout?: number;
}

export interface ReviewRemoteMcpServerConfig {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  tools?: string[];
  timeout?: number;
}

export interface ReviewContext7OverrideConfig {
  type: "context7";
  tools?: string[];
  timeout?: number;
}

export type ReviewMcpServerConfig =
  | ReviewLocalMcpServerConfig
  | ReviewRemoteMcpServerConfig
  | ReviewContext7OverrideConfig;

export type ReviewMcpServers = Record<string, ReviewMcpServerConfig>;
