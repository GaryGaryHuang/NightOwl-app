import assert from "node:assert/strict";
import test from "node:test";

import { LocalReviewConfigProvider } from "../../src/providers/local-review-config-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("LocalReviewConfigProvider falls back to default thresholds when .reviewconfig.json is missing", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadConfidenceThresholds(fixture.repoDir), {
      must: 80,
      nice: 90
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider falls back to default thresholds when confidenceThresholds is absent", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewconfig.json", JSON.stringify({ maxConcurrentFiles: 5 }));

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadConfidenceThresholds(fixture.repoDir), {
      must: 80,
      nice: 90
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves partial and full threshold overrides", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          must: 70
        }
      })
    );
    assert.deepEqual(provider.loadConfidenceThresholds(fixture.repoDir), {
      must: 70,
      nice: 90
    });

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          nice: 85
        }
      })
    );
    assert.deepEqual(provider.loadConfidenceThresholds(fixture.repoDir), {
      must: 80,
      nice: 85
    });

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          must: 70,
          nice: 85
        }
      })
    );
    assert.deepEqual(provider.loadConfidenceThresholds(fixture.repoDir), {
      must: 70,
      nice: 85
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider accepts boundary threshold values and ignores unrelated top-level keys", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 5,
        mcpServers: {
          demo: {
            command: "demo"
          }
        },
        confidenceThresholds: {
          must: 0,
          nice: 100
        }
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadConfidenceThresholds(fixture.repoDir), {
      must: 0,
      nice: 100
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
      () => provider.loadConfidenceThresholds(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(".reviewconfig.json", JSON.stringify([]));
    assert.throws(
      () => provider.loadConfidenceThresholds(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: []
      })
    );
    assert.throws(
      () => provider.loadConfidenceThresholds(fixture.repoDir),
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
      () => provider.loadConfidenceThresholds(fixture.repoDir),
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
      () => provider.loadConfidenceThresholds(fixture.repoDir),
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
      () => provider.loadConfidenceThresholds(fixture.repoDir),
      /invalid review config/u
    );
  } finally {
    fixture.cleanup();
  }
});
