import assert from "node:assert/strict";
import path from "node:path";
import { mock } from "node:test";
import test from "node:test";

import {
  EMPTY_TOOL_ARGS_DEFERRED_REASON,
  READONLY_BASH_DENY_REASON,
  SHELL_POLICY_FAIL_CLOSED_REASON,
  UNSAFE_WEB_FETCH_URL_REASON,
  WEB_FETCH_POLICY_FAIL_CLOSED_REASON
} from "../../src/services/tool-policy-guard.ts";
import {
  assertAuditRecord,
  createPolicySession,
  FakeHostnameClassifier,
  InMemoryAuditSink
} from "../helpers/tool-policy-fixture.ts";

const SESSION_CONTEXT = { sessionId: "s1" };

function createHookInput(
  toolName: string,
  toolArgs?: Record<string, unknown> | null
) {
  return {
    timestamp: 0,
    cwd: "/workspace/repo",
    toolName,
    toolArgs: toolArgs as Record<string, unknown> | undefined
  };
}

test("tool policy guard pre-tool hook keeps representative shell and url allow-deny behavior across canonical aliases", async () => {
  const { hook } = createPolicySession();
  const cases = [
    {
      input: createHookInput("bash", {
        command: "git diff main...feature-branch --name-status"
      }),
      expected: undefined
    },
    {
      input: createHookInput("sh", {
        command: "rm -rf /"
      }),
      expected: {
        permissionDecision: "deny",
        permissionDecisionReason: READONLY_BASH_DENY_REASON
      }
    },
    {
      input: createHookInput("shell", {
        command: "git log --oneline"
      }),
      expected: undefined
    },
    {
      input: createHookInput("web_fetch", {
        url: "https://docs.example.com/guide"
      }),
      expected: undefined
    },
    {
      input: createHookInput("url", {
        url: "http://localhost:3000"
      }),
      expected: {
        permissionDecision: "deny",
        permissionDecisionReason: UNSAFE_WEB_FETCH_URL_REASON
      }
    }
  ] as const;

  for (const testCase of cases) {
    assert.deepEqual(await hook(testCase.input, SESSION_CONTEXT), testCase.expected);
  }
});

test("tool policy guard pre-tool hook bypasses unrelated tools and leaves unknown tool names outside the guarded boundary", async () => {
  const { hook } = createPolicySession();

  assert.equal(
    await hook(
      createHookInput("view", {
        file: "src/app.ts"
      }),
      SESSION_CONTEXT
    ),
    undefined
  );
  assert.equal(
    await hook(
      createHookInput("python", {
        command: "import os; os.system('rm -rf /')"
      }),
      SESSION_CONTEXT
    ),
    undefined
  );
});

test("tool policy guard pre-tool hook defers empty or missing shell and url args and records deferred audit decisions", async () => {
  const sink = new InMemoryAuditSink();
  const { hook } = createPolicySession({ auditWriter: sink });
  const cases = [
    {
      input: createHookInput("bash"),
      expectedAudit: { tool: "bash", args: { command: "" } }
    },
    {
      input: createHookInput("web_fetch"),
      expectedAudit: { tool: "web_fetch", args: { url: "" } }
    },
    {
      input: createHookInput("url"),
      expectedAudit: { tool: "url", args: { url: "" } }
    },
    {
      input: createHookInput("bash", null),
      expectedAudit: { tool: "bash", args: { command: "" } }
    },
    {
      input: createHookInput("web_fetch", 42 as unknown as Record<string, unknown>),
      expectedAudit: { tool: "web_fetch", args: { url: "" } }
    },
    {
      input: createHookInput("sh", { command: "" }),
      expectedAudit: { tool: "sh", args: { command: "" } }
    },
    {
      input: createHookInput("shell", { command: "" }),
      expectedAudit: { tool: "shell", args: { command: "" } }
    }
  ] as const;

  for (const testCase of cases) {
    assert.equal(await hook(testCase.input, SESSION_CONTEXT), undefined);
  }

  assert.equal(sink.records.length, cases.length);

  for (const [index, testCase] of cases.entries()) {
    assertAuditRecord(sink.records[index], {
      ...testCase.expectedAudit,
      decision: "allow",
      reason: EMPTY_TOOL_ARGS_DEFERRED_REASON
    });
  }
});

test("tool policy guard pre-tool hook writes representative audit records for allow and deny decisions", async () => {
  const sink = new InMemoryAuditSink();
  const { hook } = createPolicySession({ auditWriter: sink });

  await hook(
    createHookInput("bash", {
      command: "git log --oneline -5"
    }),
    SESSION_CONTEXT
  );
  await hook(
    createHookInput("web_fetch", {
      url: "http://localhost:8080"
    }),
    SESSION_CONTEXT
  );

  assert.equal(sink.records.length, 2);
  assertAuditRecord(sink.records[0], {
    tool: "bash",
    decision: "allow",
    args: { command: "git log --oneline -5" }
  });
  assert.equal("reason" in sink.records[0], false);

  assertAuditRecord(sink.records[1], {
    tool: "web_fetch",
    decision: "deny",
    reason: UNSAFE_WEB_FETCH_URL_REASON,
    args: { url: "http://localhost:8080" }
  });
});

test("tool policy guard pre-tool hook fails closed for shell policy exceptions and preserves command extraction in audit records", async () => {
  const sink = new InMemoryAuditSink();
  const { hook } = createPolicySession({ auditWriter: sink });

  mock.method(path, "resolve", () => {
    throw new Error("simulated path.resolve failure");
  });

  try {
    assert.deepEqual(
      await hook(
        createHookInput("bash", {
          command: "git log /workspace/repo"
        }),
        SESSION_CONTEXT
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason: SHELL_POLICY_FAIL_CLOSED_REASON
      }
    );
  } finally {
    mock.restoreAll();
  }

  const throwingProxy = new Proxy({} as Record<string, unknown>, {
    has(): never {
      throw new Error("has trap throws");
    }
  });

  assert.deepEqual(
    await hook(createHookInput("bash", throwingProxy), SESSION_CONTEXT),
    {
      permissionDecision: "deny",
      permissionDecisionReason: SHELL_POLICY_FAIL_CLOSED_REASON
    }
  );

  assert.equal(sink.records.length, 2);
  assert.equal(sink.records[0].reason, SHELL_POLICY_FAIL_CLOSED_REASON);
  assert.deepEqual(sink.records[0].args, { command: "git log /workspace/repo" });
  assert.equal(sink.records[1].reason, SHELL_POLICY_FAIL_CLOSED_REASON);
  assert.deepEqual(sink.records[1].args, { command: "" });
});

test("tool policy guard pre-tool hook fails closed for url policy exceptions and records the deny reason", async () => {
  const sink = new InMemoryAuditSink();
  const { hook } = createPolicySession({
    auditWriter: sink,
    hostnameClassifier: new FakeHostnameClassifier(async () => {
      throw new Error("simulated DNS failure");
    })
  });

  assert.deepEqual(
    await hook(
      createHookInput("url", {
        url: "https://docs.example.com/guide"
      }),
      SESSION_CONTEXT
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: WEB_FETCH_POLICY_FAIL_CLOSED_REASON
    }
  );

  assert.equal(sink.records.length, 1);
  assertAuditRecord(sink.records[0], {
    tool: "url",
    decision: "deny",
    reason: WEB_FETCH_POLICY_FAIL_CLOSED_REASON,
    args: { url: "https://docs.example.com/guide" }
  });
});

test("tool policy guard pre-tool hook keeps normal deny reasons distinct from fail-closed behavior", async () => {
  const { hook } = createPolicySession();

  assert.deepEqual(
    await hook(
      createHookInput("bash", {
        command: "curl http://example.com"
      }),
      SESSION_CONTEXT
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: READONLY_BASH_DENY_REASON
    }
  );
  assert.equal(
    await hook(
      createHookInput("web_fetch", {
        url: "https://docs.example.com/guide"
      }),
      SESSION_CONTEXT
    ),
    undefined
  );
});
