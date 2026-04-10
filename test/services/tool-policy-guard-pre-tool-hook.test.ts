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

test("tool policy guard pre-tool hook defers empty or missing shell and url args across aliases", async () => {
  const { hook } = createPolicySession();
  const cases = [
    createHookInput("bash"),
    createHookInput("web_fetch"),
    createHookInput("url"),
    createHookInput("bash", null),
    createHookInput("web_fetch", 42 as unknown as Record<string, unknown>),
    createHookInput("bash", { command: "" }),
    createHookInput("sh", { command: "" }),
    createHookInput("shell", { command: "" }),
    createHookInput("web_fetch", { url: "" }),
    createHookInput("url", { url: "" })
  ];

  for (const input of cases) {
    assert.equal(await hook(input, SESSION_CONTEXT), undefined);
  }
});

test("tool policy guard pre-tool hook records deferred audit decisions for empty shell and url args", async () => {
  const sink = new InMemoryAuditSink();
  const { hook } = createPolicySession({ auditWriter: sink });

  for (const toolName of ["bash", "sh", "shell"] as const) {
    await hook(createHookInput(toolName, { command: "" }), SESSION_CONTEXT);
  }

  for (const toolName of ["web_fetch", "url"] as const) {
    await hook(createHookInput(toolName, { url: "" }), SESSION_CONTEXT);
  }

  assert.equal(sink.records.length, 5);

  for (const record of sink.records.slice(0, 3)) {
    assert.equal(record.decision, "allow");
    assert.equal(record.reason, EMPTY_TOOL_ARGS_DEFERRED_REASON);
    assert.deepEqual(record.args, { command: "" });
  }

  for (const record of sink.records.slice(3)) {
    assert.equal(record.decision, "allow");
    assert.equal(record.reason, EMPTY_TOOL_ARGS_DEFERRED_REASON);
    assert.deepEqual(record.args, { url: "" });
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
  assert.equal(sink.records[0].tool, "bash");
  assert.equal(sink.records[0].decision, "allow");
  assert.deepEqual(sink.records[0].args, { command: "git log --oneline -5" });
  assert.equal("reason" in sink.records[0], false);

  assert.equal(sink.records[1].tool, "web_fetch");
  assert.equal(sink.records[1].decision, "deny");
  assert.equal(sink.records[1].reason, UNSAFE_WEB_FETCH_URL_REASON);
  assert.deepEqual(sink.records[1].args, { url: "http://localhost:8080" });
});

test("tool policy guard pre-tool hook preserves incoming shell alias names in audit records", async () => {
  const sink = new InMemoryAuditSink();
  const { hook } = createPolicySession({ auditWriter: sink });

  await hook(
    createHookInput("sh", {
      command: "git log --oneline"
    }),
    SESSION_CONTEXT
  );
  await hook(
    createHookInput("shell", {
      command: "rm -rf /"
    }),
    SESSION_CONTEXT
  );

  assert.deepEqual(
    sink.records.map((record) => record.tool),
    ["sh", "shell"]
  );
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

test("tool policy guard pre-tool hook denies shell policy failures for both Error and non-Error throws", async () => {
  const { hook } = createPolicySession();

  for (const thrownValue of [new Error("simulated failure"), "non-error string thrown"] as const) {
    mock.method(path, "resolve", () => {
      throw thrownValue;
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
  }
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
  assert.equal(sink.records[0].tool, "url");
  assert.equal(sink.records[0].decision, "deny");
  assert.equal(sink.records[0].reason, WEB_FETCH_POLICY_FAIL_CLOSED_REASON);
  assert.deepEqual(sink.records[0].args, { url: "https://docs.example.com/guide" });
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
