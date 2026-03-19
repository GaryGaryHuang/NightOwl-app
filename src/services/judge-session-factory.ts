import type { SessionConfig } from "@github/copilot-sdk";

import {
  CopilotClientManager,
  SessionExecutor
} from "./session-executor.ts";

export interface JudgeSessionProfile {
  model: string;
  systemMessage: string;
}

export interface JudgeSessionFactoryOptions {
  clientManager: Pick<CopilotClientManager, "getClient">;
}

export class JudgeSessionFactory {
  readonly #clientManager: Pick<CopilotClientManager, "getClient">;

  constructor(options: JudgeSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
  }

  async createSession(profile: JudgeSessionProfile): Promise<SessionExecutor> {
    const sessionConfig: SessionConfig = {
      availableTools: [],
      model: profile.model,
      streaming: false,
      systemMessage: {
        mode: "replace",
        content: profile.systemMessage
      }
    };
    const session = await this.#clientManager.getClient().createSession(sessionConfig);

    return new SessionExecutor(session);
  }
}
