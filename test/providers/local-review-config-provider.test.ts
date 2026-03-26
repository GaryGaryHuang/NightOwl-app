import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider falls back to the documented default review config when .reviewconfig.json is missing", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    assert.deepEqual(configFixture.loadReviewConfig(), buildExpectedReviewConfig());
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider falls back to defaults when maxConcurrentFiles or confidenceThresholds are absent", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({});
    assert.deepEqual(configFixture.loadReviewConfig(), buildExpectedReviewConfig());

    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({ maxConcurrentFiles: 2 })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves maxConcurrentFiles and confidenceThresholds from the same config file", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 70,
        nice: 85
      },
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          tools: ["*"]
        }
      },
      webFetchAllowedHosts: [" Docs.Example.Com. ", "react.dev"]
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        maxConcurrentFiles: 2,
        confidenceThresholds: {
          must: 70,
          nice: 85
        },
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            tools: ["*"]
          }
        },
        webFetchAllowedHosts: ["docs.example.com", "react.dev"]
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider accepts boundary threshold values and a validated remote-compatible context7 override while keeping default maxConcurrentFiles", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          type: "http",
          tools: ["resolve-library-id"],
          timeout: 20000
        }
      },
      confidenceThresholds: {
        must: 0,
        nice: 100
      }
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        confidenceThresholds: {
          must: 0,
          nice: 100
        },
        mcpServers: {
          context7: {
            type: "http",
            tools: ["resolve-library-id"],
            timeout: 20000
          }
        }
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects malformed or invalid review config", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeRawReviewConfig("{");
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig([]);
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      maxConcurrentFiles: 0
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      maxConcurrentFiles: -1
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2.5
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      maxConcurrentFiles: "2"
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      confidenceThresholds: []
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      confidenceThresholds: {
        musst: 70
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      confidenceThresholds: {
        must: 101
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      confidenceThresholds: {
        nice: "85"
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      mcpServers: []
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local"
        }
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "remote",
          command: "https://example.com/mcp"
        }
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: "--bad"
        }
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          headers: {
            Authorization: "Bearer repo-token"
          }
        }
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          url: "https://context7.example.com/mcp"
        }
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          command: "npx"
        }
      }
    });
    assert.throws(
      () => configFixture.loadReviewConfig(),
      /invalid review config/u
    );

  } finally {
    configFixture.cleanup();
  }
});
