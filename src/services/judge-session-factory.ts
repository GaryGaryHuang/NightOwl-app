import { approveAll, type SessionConfig } from "@github/copilot-sdk";

import type { JudgeSessionFactoryLike } from "../core/session-factory-contracts.ts";
import type { CopilotClientLike } from "./copilot-client-manager.ts";
import { SessionExecutor } from "./session-executor.ts";

export interface JudgeSessionProfile {
  model: string;
  systemMessage: string;
}

export interface JudgeSessionFactoryOptions {
  clientManager: {
    getClient(): Pick<CopilotClientLike, "createSession">;
  };
}

/**
 * Build isolated judge sessions that are intended to stay text-only and never expose tool access.
 */
export class JudgeSessionFactory implements JudgeSessionFactoryLike {
  readonly #clientManager: JudgeSessionFactoryOptions["clientManager"];

  constructor(options: JudgeSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
  }

  async createSession(profile: JudgeSessionProfile): Promise<SessionExecutor> {
    const sessionConfig: SessionConfig = {
      // No tools are exposed here, so the judge session can only evaluate the supplied text.
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
