import assert from "node:assert/strict";
import test from "node:test";

import {
  PATH_NOT_FOUND_FAILURE_GUIDANCE,
  VIEW_ABSOLUTE_PATH_FAILURE_GUIDANCE
} from "../../src/services/tool-policy/tool-policy-guard.ts";
import {
  createPolicySession,
  InMemoryAuditSink
} from "../helpers/tool-policy-fixture.ts";

const SESSION_CONTEXT = { sessionId: "s1" };

function createFailureInput(
  toolName: string,
  error: string,
  toolArgs?: Record<string, unknown>
) {
  return {
    sessionId: SESSION_CONTEXT.sessionId,
    timestamp: new Date(0),
    workingDirectory: "/workspace/repo",
    toolName,
    toolArgs: toolArgs as Record<string, unknown> | undefined,
    error
  };
}

test("post-tool failure hook returns absolute-path guidance when view rejects a relative path", async () => {
  const sink = new InMemoryAuditSink();
  const { failureHook } = createPolicySession({ auditWriter: sink });

  const result = await failureHook(
    createFailureInput("view", "Path not absolute", {
      path: "KKBOX/src/main/java/com/kkbox/App.kt"
    }),
    SESSION_CONTEXT
  );

  assert.deepEqual(result, {
    additionalContext: VIEW_ABSOLUTE_PATH_FAILURE_GUIDANCE
  });
  assert.equal(sink.records.length, 1);
  assert.equal(sink.records[0]?.tool, "view");
  assert.equal(sink.records[0]?.decision, "failure");
  assert.equal(sink.records[0]?.reason, "Path not absolute");
});

test("post-tool failure hook returns discovery guidance when a view path does not exist", async () => {
  const { failureHook } = createPolicySession();

  const result = await failureHook(
    createFailureInput("view", "Path does not exist", {
      path: "/snap/KKBOX/src/main/java/com/kkbox/Missing.kt"
    }),
    SESSION_CONTEXT
  );

  assert.deepEqual(result, {
    additionalContext: PATH_NOT_FOUND_FAILURE_GUIDANCE
  });
});

test("post-tool failure hook returns discovery guidance when a search path is missing", async () => {
  const { failureHook } = createPolicySession();

  const result = await failureHook(
    createFailureInput(
      "rg",
      "rg: KKBOX/src/main/java/com/kkbox/repository: IO error for operation on KKBOX/src/main/java/com/kkbox/repository: No such file or directory (os error 2)",
      { paths: "KKBOX/src/main/java/com/kkbox/repository" }
    ),
    SESSION_CONTEXT
  );

  assert.deepEqual(result, {
    additionalContext: PATH_NOT_FOUND_FAILURE_GUIDANCE
  });
});

test("post-tool failure hook records audit but adds no guidance for unrecognized failures", async () => {
  const sink = new InMemoryAuditSink();
  const { failureHook } = createPolicySession({ auditWriter: sink });

  const result = await failureHook(
    createFailureInput("bash", "fatal: bad revision 'HEAD~999'"),
    SESSION_CONTEXT
  );

  assert.equal(result, undefined);
  assert.equal(sink.records.length, 1);
  assert.equal(sink.records[0]?.tool, "bash");
  assert.equal(sink.records[0]?.decision, "failure");
});

test("post-tool failure hook does not treat a web_fetch not-found as a path failure", async () => {
  const sink = new InMemoryAuditSink();
  const { failureHook } = createPolicySession({ auditWriter: sink });

  const result = await failureHook(
    createFailureInput("web_fetch", "Request failed: 404 Not Found", {
      url: "https://docs.example.com/missing"
    }),
    SESSION_CONTEXT
  );

  assert.equal(result, undefined);
  assert.equal(sink.records.length, 1);
  assert.equal(sink.records[0]?.tool, "web_fetch");
  assert.equal(sink.records[0]?.decision, "failure");
});

test("post-tool failure hook returns discovery guidance when a glob path is missing", async () => {
  const { failureHook } = createPolicySession();

  const result = await failureHook(
    createFailureInput("glob", "ENOENT: no such file or directory", {
      pattern: "KKBOX/src/missing/**/*.kt"
    }),
    SESSION_CONTEXT
  );

  assert.deepEqual(result, {
    additionalContext: PATH_NOT_FOUND_FAILURE_GUIDANCE
  });
});

test("post-tool failure hook only applies absolute-path guidance to the view tool", async () => {
  const { failureHook } = createPolicySession();

  const result = await failureHook(
    createFailureInput("grep", "pattern not absolute", {
      pattern: "foo"
    }),
    SESSION_CONTEXT
  );

  assert.equal(result, undefined);
});
