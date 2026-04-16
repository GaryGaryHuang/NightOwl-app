# NightOwl

> **Status:** Early development (v0.1.0) — APIs, output formats, and CLI interface may change.

NightOwl is a local Code Review CLI tool powered by the [GitHub Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk). It drives an AI Agent to automatically perform structured Code Reviews on Git changes and produce traceable Markdown review reports.

[Why NightOwl?](#why-nightowl) • [Quick Start](#quick-start) • [Usage](#usage) • [Configuration](#configuration) • [Development](#development) • [Architecture](#architecture)

## Why NightOwl?

- **Structured**: every review follows the same multi-step SOP and format
- **Traceable**: every finding maps to a specific file, line number, or diff hunk
- **Reproducible**: the same inputs produce a consistent review structure, not free-form conversation

The generated reports can serve as a starting point for engineer self-review or human review.

## Quick Start

### Prerequisites

- Node.js ≥ 22.7.0
- A [GitHub Copilot](https://github.com/features/copilot) subscription
- GitHub authentication via one of:
  - [GitHub CLI](https://cli.github.com/) — `gh auth login`
  - [GitHub Copilot CLI](https://docs.github.com/en/copilot/managing-copilot/configure-personal-settings/installing-github-copilot-in-the-cli) — authenticate on first launch

### Installation

```bash
git clone https://github.com/GaryGaryHuang/NightOwl-app.git && cd NightOwl-app
npm install
npm install -g .
```

For development, use `npm link` instead (see [Development](#development)).

### Verify Setup

```bash
review --check
```

Prints `GitHub Copilot is available.` on success. If the check fails, verify your Copilot agent is running and authenticated.

## Usage

```bash
review <base_ref> <head_ref> [--repo <path>] [--context <value>] [--dry-run]
```

| Flag | Description |
|------|-------------|
| `--repo <path>` | Path to the Git repository (default: current working directory) |
| `--context <value>` | Additional context passed to the AI reviewer (e.g. PR description, spec links). Repeatable |
| `--dry-run` | Run the full pipeline with deterministic stubs instead of calling the Copilot API |

**Examples:**

```bash
review main feature-branch
review main HEAD --repo /path/to/repo
review main HEAD --context "Performance optimization PR" --context "https://link-to-spec"
review main feature-branch --dry-run
```

## Review Output

A review run prints progress to the terminal and writes artifacts to disk:

```text
Starting review run for main...feature-branch.
Output: /path/to/repo/.nightowl/review/feature-branch_03131430
Review run completed.
Planned files: 3
Successful files: 2
Skipped files: 1
```

In an interactive terminal, a `Progress ...` line is redrawn in place during the run and cleared before the final summary. In dry-run mode, output is prefixed with `[DRY RUN]`.

### Output Artifacts

Each run produces output under `<repo_root>/.nightowl/review/<session_id>/`:

| File | Description |
|------|-------------|
| `files/*.md` | Structured review notes for each changed file |
| `changeset-overview.md` | Run-level changeset overview produced by Step 0 |
| `summary.md` | Risk distribution, findings statistics, per-file risk ranking |
| `index.md` | Landing page linking all per-file notes, overview, and summary |
| `manifest.json` | Machine-readable metadata: repo info, aggregate counts, per-file outcomes |
| `tool-audit.jsonl` | Tool usage audit log (every allow/deny decision) |
| `skipped.md` | Record of files skipped due to failure |

## Configuration

Place an optional configuration file at `<repo_root>/.nightowl/reviewconfig.json`:

```json
{
  "maxConcurrentFiles": 5,
  "confidenceThresholds": { "must": 80, "nice": 90 },
  "mcpServers": {},
  "webFetchAllowedHosts": ["docs.example.com", "*.github.com"],
  "webFetchDeniedHosts": ["internal.corp.com"]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxConcurrentFiles` | `5` | Number of files processed in parallel |
| `confidenceThresholds.must` | `80` | Minimum confidence (0–100) to include a must-fix finding |
| `confidenceThresholds.nice` | `90` | Minimum confidence (0–100) to include a nice-to-have finding |
| `mcpServers` | `{}` | Additional [MCP](https://modelcontextprotocol.io/) servers the AI agent can access during review |
| `webFetchAllowedHosts` | — | Hosts the AI agent is allowed to fetch via HTTPS during review |
| `webFetchDeniedHosts` | — | Hosts explicitly blocked from fetch (deny-over-allow) |

File filtering uses `<repo_root>/.nightowl/reviewignore` (`.gitignore` syntax).

## How It Works

NightOwl runs a two-phase review pipeline:

1. **Step 0 — Changeset Overview**: scans the entire changeset once to build global context (scope of changes, cross-file relationships, user-provided context).
2. **Steps 1–7 — Per-file review**: each changed file goes through 7 sequential steps — from building file-level understanding, through dependency analysis and risk scenario generation, to validation, cognitive simulation, and a final summary. Files are processed in parallel (bounded concurrency, default 5).

Each per-file step runs in its own Copilot SDK session with a completion check (Agent Judge or deterministic validation). A failed step retries once; if it fails again, the file is skipped.

## Development

TypeScript (strict mode, ESM). Tests use the Node.js built-in test runner (`node:test`).

```bash
npm install          # Install dependencies
npm link             # Symlink the review command locally
npm test             # Build + verify manifest + run all tests
npm run test:unit    # Run fast deterministic logic-owner tests
npm run test:integration  # Run boundary/collaboration tests
npm run test:e2e     # Run thin published-surface guardrails
npm run typecheck    # Type check (tsc --noEmit)
npm run build        # Produce dist/
```

The primary test commands (`npm test`, `test:unit`, `test:integration`, `test:e2e`) run `npm run build` first and then execute source test files under `test/`.

Run a single test file:

```bash
npm run build && node --test test/core/orchestrator-bounded-concurrency.test.ts
```

Run locally without building:

```bash
npm run review -- main feature-branch
```

See [TESTING.md](./TESTING.md) for tier decision criteria, test patterns, fixture catalog, and manifest maintenance rules.

## Architecture

```
src/
├── bin/            CLI entry point
├── cli/            CLI argument parsing → RunRequest
├── app/            Composition root: dependency wiring, lifecycle, signal handling
├── core/           Business logic: orchestrator, step runner, steps, finalizers
├── providers/      External I/O adapters (Git, filesystem, config)
└── services/       Copilot SDK session management, tool policy, MCP injection
```

See [AGENTS.md](./AGENTS.md) for detailed architecture, layer boundaries, and design rules.
