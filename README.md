# NightOwl

> **Status:** Early development (v0.1.0) — APIs, output formats, and the command-line interface may change.

NightOwl is a local code review CLI powered by the [GitHub Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk). It drives an AI agent to automatically perform structured code reviews on Git changes and produce traceable Markdown review reports.

## Why NightOwl?

- **Structured**: every review follows the same multi-step workflow and output format
- **Traceable**: every finding maps to a specific file, line number, or diff hunk
- **Reproducible**: the same inputs produce a consistent review structure, not free-form conversation

The generated reports can serve as a starting point for self-review or human review.

## Quick Start

### Prerequisites

- Node.js ≥ 22.18.0
- Standard review runs and `review --check` require a [GitHub Copilot](https://github.com/features/copilot) subscription and an authenticated [GitHub Copilot CLI](https://docs.github.com/en/copilot/managing-copilot/configure-personal-settings/installing-github-copilot-in-the-cli) — run `/login` on first launch
- `review --dry-run` does not require Copilot CLI authentication or a Copilot subscription

### Installation

Install from a published npm package or package artifact so the `review` executable is available:

```bash
npm install -g <package-or-tarball>
```

For development from a source checkout, use `npm link` instead (see [Development](#development)).

### Verify Setup

```bash
review --check
```

Prints `GitHub Copilot is available.` on success.

## Usage

```bash
review <base_ref> <head_ref> [--repo <path>] [--context <value>] [--dry-run]
```

| Flag | Description |
|------|-------------|
| `--repo <path>` | Path to the Git repository (default: current working directory) |
| `--context <value>` | Requirement or background context passed into the review (e.g. PR description, root cause, expected behavior, spec links). Repeatable |
| `--dry-run` | Run the full pipeline with deterministic local responses instead of calling GitHub Copilot |

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

In an interactive terminal, a `Progress ...` line is redrawn in place during the run and cleared before the final summary. In non-interactive output, NightOwl appends significant progress snapshots, skipped-file messages, warnings, and review diagnostics as separate lines. In dry-run mode, the startup line and final completion header are prefixed with `[DRY RUN]`.

### Output Artifacts

Each run produces output under `<repo_root>/.nightowl/review/<session_id>/`:

| File | Description |
|------|-------------|
| `files/*.md` | Structured review notes for each file selected for review |
| `changeset-overview.md` | Run-level overview of the reviewed changeset |
| `index.md` | Landing page linking all per-file notes and embedding run summary details |
| `tool-audit.jsonl` | Best-effort tool usage audit log for allow/deny decisions |

## Configuration

Place an optional configuration file at `<repo_root>/.nightowl/reviewconfig.json`:

```json
{
  "maxConcurrentFiles": 5,
  "mcpServers": {},
  "webFetchAllowedHosts": ["docs.example.com", "*.github.com"],
  "webFetchDeniedHosts": ["internal.corp.com"]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxConcurrentFiles` | `5` | Number of files processed in parallel |
| `mcpServers` | `{}` | Additional [MCP](https://modelcontextprotocol.io/) servers the AI agent can access during review |
| `webFetchAllowedHosts` | — | Hosts the AI agent may fetch from via HTTPS during review |
| `webFetchDeniedHosts` | — | Hosts blocked from AI agent HTTPS fetches; deny rules override allow rules |

File filtering uses `<repo_root>/.nightowl/reviewignore` (`.gitignore` syntax).

## How It Works

NightOwl runs a three-stage review pipeline:

1. **Changeset Overview**: scans the entire changeset once to build global context (scope of changes, cross-file relationships, user-provided context).
2. **Per-file semantic review**: NightOwl runs four steps for each file selected for review: Review Basis, Candidate Findings, Semantic Validation, and Review Summary. Semantic Validation can send a file back through Candidate Findings before Review Summary when more evidence is needed. Files are processed in parallel with bounded concurrency (default 5), while steps remain strictly sequential within each file.
3. **Run-level finalization**: writes the index and embedded run summary after every file selected for review finishes.

Each per-file step attempt runs in its own Copilot SDK session and must pass deterministic validation before NightOwl uses the result. Per-file steps use three total attempts; if a step fails after those attempts, the file is skipped.

## Development

TypeScript (strict mode, ESM). Tests use the Node.js built-in test runner (`node:test`).

```bash
npm install          # Install dependencies
npm run build        # Produce dist/
npm link             # Symlink the built `review` command locally
npm test             # Build + verify manifest + run all tests
npm run test:unit    # Run fast deterministic unit tests
npm run test:integration  # Run boundary/collaboration tests
npm run test:e2e     # Run published CLI surface checks
npm run typecheck    # Type check (tsc --noEmit)
```

The primary test commands (`npm test`, `test:unit`, `test:integration`, `test:e2e`) run `npm run build` first, verify `test/test-tier-manifest.json`, and then execute source test files under `test/`.

Run a single test file:

```bash
npm run build && node --test test/core/orchestrator-bounded-concurrency.test.ts
```

Run locally without building:

```bash
npm run review -- main feature-branch
```

See [TESTING.md](https://github.com/GaryGaryHuang/NightOwl-app/blob/main/TESTING.md) for tier decision criteria, test patterns, fixture catalog, and manifest maintenance rules.

## Architecture

```
src/
├── bin/            CLI entry point
├── cli/            CLI argument parsing → RunRequest
├── app/            Composition root: dependency wiring, lifecycle, signal handling
├── core/           Business logic: orchestrator, step runner, steps, finalizers
├── providers/      External I/O adapters (Git, filesystem, config)
└── services/       Copilot SDK session management, tool policy, MCP setup
```

See [AGENTS.md](https://github.com/GaryGaryHuang/NightOwl-app/blob/main/AGENTS.md) for detailed architecture, layer boundaries, and design rules.
