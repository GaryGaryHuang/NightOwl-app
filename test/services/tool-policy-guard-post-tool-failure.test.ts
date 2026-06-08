import assert from "node:assert/strict";
import test from "node:test";

import {
  GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE,
  PATH_NOT_FOUND_FAILURE_GUIDANCE,
  TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE,
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

test("post-tool failure hook returns retry guidance for unsupported search type filters", async () => {
  const { failureHook } = createPolicySession();

  const result = await failureHook(
    createFailureInput("grep", "rg: unrecognized file type: kt", {
      pattern: "PodcastApi",
      type: "kt"
    }),
    SESSION_CONTEXT
  );

  assert.deepEqual(result, {
    additionalContext: GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE
  });
  assert.match(
    GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE,
    /`type` filter is not recognized/u
  );
  assert.match(
    GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE,
    /Retry grep\/rg with structured arguments/u
  );
  assert.match(
    GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE,
    /set `pattern`/u
  );
  assert.match(
    GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE,
    /`paths` and\/or `glob`/u
  );
  assert.match(
    GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE,
    /omit the invalid `type` field/u
  );
  assert.doesNotMatch(
    GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE,
    /remove `type` entirely/u
  );
  assert.doesNotMatch(
    GREP_UNSUPPORTED_TYPE_FILTER_FAILURE_GUIDANCE,
    /`java`/u
  );
});

test("post-tool failure hook returns retry guidance for malformed retrieval tool args", async () => {
  const { failureHook } = createPolicySession();

  const result = await failureHook(
    createFailureInput(
      "grep",
      "Expected double-quoted property name in JSON at position 149 (line 1 column 150)",
      {}
    ),
    SESSION_CONTEXT
  );

  assert.deepEqual(result, {
    additionalContext: TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE
  });
  assert.match(
    TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE,
    /exactly one valid JSON object/u
  );
  assert.match(
    TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE,
    /documented structured fields only/u
  );
  assert.match(
    TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE,
    /do not pass CLI flag tokens as raw strings or arrays/u
  );
  assert.match(
    TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE,
    /If retrying grep\/rg and line numbers are needed/u
  );
  assert.match(
    TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE,
    /`"-n": true`/u
  );
  assert.match(
    TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE,
    /`"output_mode": "content"`/u
  );
  assert.doesNotMatch(
    TOOL_ARGUMENT_SYNTAX_FAILURE_GUIDANCE,
    /`pattern`, `paths`, `output_mode`, and `glob`/u
  );
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
