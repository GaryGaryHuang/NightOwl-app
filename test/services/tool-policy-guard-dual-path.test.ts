import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_PROFILE,
  createPolicySession,
  FakeHostnameClassifier
} from "../helpers/tool-policy-fixture.ts";

const SESSION_CONTEXT = { sessionId: "s1" };

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

test("dual-path consistency: shell allow produces matching decisions from both handler and hook", async () => {
  const { handler, hook } = createPolicySession();

  const handlerResult = await handler(
    { kind: "shell", fullCommandText: "git log --oneline" },
    SESSION_CONTEXT
  );
  const hookResult = await hook(
    createHookInput("bash", { command: "git log --oneline" }),
    SESSION_CONTEXT
  );

  assert.deepEqual(handlerResult, { kind: "approved" });
  assert.equal(hookResult, undefined);
});

test("dual-path consistency: shell deny produces matching decisions from both handler and hook", async () => {
  const { handler, hook } = createPolicySession();

  const handlerResult = await handler(
    { kind: "shell", fullCommandText: "rm -rf /" },
    SESSION_CONTEXT
  );
  const hookResult = await hook(
    createHookInput("bash", { command: "rm -rf /" }),
    SESSION_CONTEXT
  );

  assert.deepEqual(handlerResult, {
    kind: "denied-no-approval-rule-and-could-not-request-from-user"
  });
  assert.notEqual(hookResult, undefined);
  assert.equal(
    (hookResult as { permissionDecision: string }).permissionDecision,
    "deny"
  );
});

test("dual-path consistency: url allow produces matching decisions from both handler and hook", async () => {
  const { handler, hook } = createPolicySession({
    hostnameClassifier: new FakeHostnameClassifier({ kind: "allowed" })
  });

  const handlerResult = await handler(
    { kind: "url", url: "https://example.com" },
    SESSION_CONTEXT
  );
  const hookResult = await hook(
    createHookInput("web_fetch", { url: "https://example.com" }),
    SESSION_CONTEXT
  );

  assert.deepEqual(handlerResult, { kind: "approved" });
  assert.equal(hookResult, undefined);
});

test("dual-path consistency: url deny produces matching decisions from both handler and hook", async () => {
  const { handler, hook } = createPolicySession({
    hostnameClassifier: new FakeHostnameClassifier({ kind: "denied", reason: "Hostname resolved to non-public address" })
  });

  const handlerResult = await handler(
    { kind: "url", url: "http://localhost:8080" },
    SESSION_CONTEXT
  );
  const hookResult = await hook(
    createHookInput("web_fetch", { url: "http://localhost:8080" }),
    SESSION_CONTEXT
  );

  assert.deepEqual(handlerResult, {
    kind: "denied-no-approval-rule-and-could-not-request-from-user"
  });
  assert.notEqual(hookResult, undefined);
  assert.equal(
    (hookResult as { permissionDecision: string }).permissionDecision,
    "deny"
  );
});
