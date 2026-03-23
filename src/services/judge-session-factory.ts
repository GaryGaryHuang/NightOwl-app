import { approveAll, type SessionConfig } from "@github/copilot-sdk";

import {
  type CopilotClientLike,
  SessionExecutor
} from "./session-executor.ts";

export interface JudgeSessionProfile {
  model: string;
  systemMessage: string;
}

export interface JudgeSessionFactoryOptions {
  clientManager: {
    getClient(): Pick<CopilotClientLike, "createSession">;
  };
}

export class JudgeSessionFactory {
  readonly #clientManager: JudgeSessionFactoryOptions["clientManager"];

  constructor(options: JudgeSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
  }

  async createSession(profile: JudgeSessionProfile): Promise<SessionExecutor> {
    const sessionConfig: SessionConfig = {
      availableTools: [],
      model: profile.model,
      onPermissionRequest: approveAll,
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
