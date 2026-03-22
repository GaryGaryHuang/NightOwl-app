import assert from "node:assert/strict";
import test from "node:test";

import { LocalReviewConfigProvider } from "../../src/providers/local-review-config-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("LocalReviewConfigProvider falls back to the documented default review config when .reviewconfig.json is missing", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: {
        must: 80,
        nice: 90
      },
      mcpServers: {}
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider falls back to defaults when maxConcurrentFiles or confidenceThresholds are absent", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    fixture.writeFile(".reviewconfig.json", JSON.stringify({}));
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: {
        must: 80,
        nice: 90
      },
      mcpServers: {}
    });

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 80,
        nice: 90
      },
      mcpServers: {}
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves maxConcurrentFiles and confidenceThresholds from the same config file", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
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
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
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
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider accepts boundary threshold values and a validated partial context7 override while keeping default maxConcurrentFiles", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            env: {
              CUSTOM_FLAG: "1"
            },
            tools: ["resolve-library-id"]
          }
        },
        confidenceThresholds: {
          must: 0,
          nice: 100
        }
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: {
        must: 0,
        nice: 100
      },
      mcpServers: {
        context7: {
          type: "local",
          env: {
            CUSTOM_FLAG: "1"
          },
          tools: ["resolve-library-id"]
        }
      }
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider preserves baseline web_fetch behavior when webFetchAllowedHosts is absent", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2,
        confidenceThresholds: {
          must: 70,
          nice: 85
        }
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 70,
        nice: 85
      },
      mcpServers: {}
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects malformed or invalid review config", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    fixture.writeFile(".reviewconfig.json", "{");
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(".reviewconfig.json", JSON.stringify([]));
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 0
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: -1
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2.5
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: "2"
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: []
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          musst: 70
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          must: 101
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          nice: "85"
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: []
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "remote",
            command: "https://example.com/mcp"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: "--bad"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            env: {
              API_KEY: 123
            }
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: "docs.example.com"
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: [123]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["   "]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["https://docs.example.com"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["docs.example.com:8443"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["docs.example.com/guide"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["*.example.com"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["192.168.1.10"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );
  } finally {
    fixture.cleanup();
  }
});
