import assert from "node:assert/strict";
import test from "node:test";

import {
  READONLY_BASH_DENY_REASON,
  UNSAFE_WEB_FETCH_URL_REASON
} from "../../src/services/tool-policy/tool-policy-guard.ts";
import {
  BASE_PROFILE,
  createPermissionRequest,
  createPolicySession
} from "../helpers/tool-policy-fixture.ts";

const SESSION_CONTEXT = { sessionId: "s1" };
const denied = (feedback: string) => ({ kind: "reject", feedback }) as const;

function createHookInput(
  toolName: string,
  toolArgs: Record<string, unknown>
) {
  return {
    timestamp: 0,
    cwd: BASE_PROFILE.repoRoot,
    toolName,
    toolArgs
  };
}

test("dual-path consistency: shell deny remains aligned between handler and hook", async () => {
  const { handler, hook } = createPolicySession();

  const handlerResult = await handler(
    createPermissionRequest({ kind: "shell", fullCommandText: "rm -rf /" }),
    SESSION_CONTEXT
  );
  const hookResult = await hook(
    createHookInput("bash", { command: "rm -rf /" }),
    SESSION_CONTEXT
  );

  assert.deepEqual(handlerResult, denied(READONLY_BASH_DENY_REASON));
  assert.notEqual(hookResult, undefined);
  assert.equal(
    (hookResult as { permissionDecision: string }).permissionDecision,
    "deny"
  );
});

test("dual-path consistency: URL deny remains aligned between handler and hook", async () => {
  const { handler, hook } = createPolicySession();

  const handlerResult = await handler(
    createPermissionRequest({ kind: "url", url: "http://localhost:8080" }),
    SESSION_CONTEXT
  );
  const hookResult = await hook(
    createHookInput("web_fetch", { url: "http://localhost:8080" }),
    SESSION_CONTEXT
  );

  assert.deepEqual(handlerResult, denied(UNSAFE_WEB_FETCH_URL_REASON));
  assert.notEqual(hookResult, undefined);
  assert.equal(
    (hookResult as { permissionDecision: string }).permissionDecision,
    "deny"
  );
});
