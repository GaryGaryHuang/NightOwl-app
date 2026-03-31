# NightOwl

NightOwl is a local Code Review CLI tool powered by the [GitHub Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk). It drives an AI Agent to automatically perform structured Code Reviews on Git changes and produce traceable Markdown review reports.

## Why NightOwl?

Manual Code Review is time-consuming, inconsistent in quality, and difficult to guarantee the same review dimensions are covered every time. NightOwl automates a rigorous multi-step Code Review SOP with the following goals:

- **Structured**: every review follows the same steps and format to produce reports
- **Traceable**: every finding maps to a specific file, line number, or diff hunk
- **Reproducible**: the same inputs produce a consistent review structure, not free-form conversation

The generated reports can serve as a starting point for engineer self-review or human review.

## Quick Start

### Prerequisites

- Node.js ≥ 22.7.0
- [GitHub Copilot CLI](https://docs.github.com/en/copilot) installed and authenticated

Recommended preflight:

```bash
review --check
```

Run the preflight command after installing or re-authenticating GitHub Copilot CLI, and before starting a full review run.

### Installation

```bash
# Install from package artifact
npm pack
npm install -g ./nightowl-0.1.0.tgz
```

### Usage

```bash
review --check
review <base_ref> <head_ref> [--repo <path>] [--context <value>] [--dry-run]
```

**Examples:**

```bash
review --check
review main feature-branch
review main HEAD --repo /path/to/repo
review main HEAD --context "Performance optimization PR" --context "https://link-to-spec"
review main feature-branch --dry-run
```

### Copilot Availability Check

Run `review --check` when you want to confirm that GitHub Copilot CLI is installed, authenticated, and responsive before executing a full review:

```text
GitHub Copilot is available.
```

If the check fails, NightOwl exits with a non-zero status and preserves the underlying error message so you can troubleshoot CLI installation, authentication, or service connectivity without entering the review pipeline.

### Review Output

```text
Starting review run for main...feature-branch.
Output: /path/to/repo/.nightowl/review/feature-branch_03131430
Review run completed.
Planned files: 3
Successful files: 2
Skipped files: 1
```

In an interactive terminal, the `Progress ...` line is redrawn in place and cleared before the final summary prints.

In dry-run mode, the first line is prefixed with `[DRY RUN]`:

```text
[DRY RUN] Starting review run for main...feature-branch.
[DRY RUN] Review run completed.
...
```

### Dry-Run Mode

Pass `--dry-run` to run the full pipeline without calling the Copilot API or requiring Copilot CLI to be installed and authenticated:

- All Git operations, path planning, bounded concurrency, and output rendering run identically to a normal run.
- Every AI session is replaced by a deterministic stub that returns pre-built placeholder responses for each SOP step.
- The output folder structure and artifact names are identical to a real run; only the review note content is placeholder text.
- The `[DRY RUN]` prefix appears in the startup feedback and final CLI summary.
- `tool-audit.jsonl` is present but empty (no tools are called).

Use it to validate the pipeline end-to-end in CI or offline environments where Copilot CLI is not available.

### Troubleshooting Copilot Availability

If `review --check` fails:

- Confirm GitHub Copilot CLI is installed and available in `PATH`
- Re-authenticate Copilot CLI if your login or subscription has expired
- Retry `review --check` before running a full review so availability issues stay isolated from review-run failures

## Review Pipeline

NightOwl's review pipeline consists of two phases:

### Step 0: Changeset Overview (run-level)

Before entering per-file review, the entire changeset is scanned once to build a global context (`RunContext`), capturing the scope of changes, cross-file relationships, and user context.

### Step 1–7: Per-file Pipeline

Each changed file goes through 7 steps in sequence (files are processed in parallel via bounded concurrency):

| Step | Name | Purpose |
|------|------|---------|
| 1 | Overview | Build file-level understanding, combining global and file perspectives |
| 2 | Dependencies & Boundaries | Inventory dependencies, contract changes, and implicit dependencies |
| 3 | Knowledge & Source of Truth | Fill knowledge gaps, confirm review scope and assumptions |
| 4 | Strategy & What-if Scenarios | Identify high-risk areas, enumerate 3–8 hypothetical scenarios |
| 5 | Validation & Interrogation | Validate each scenario, produce first-pass findings |
| 6 | Cognitive Simulation | End-to-end simulation, reconcile and harmonize findings |
| 7 | Summary | Review basis, behavior change alerts, and risk assessment |

**Quality gates:**

- Steps 1–4, 7 use an Agent Judge for completion checks
- Steps 5–6 use deterministic validation (JSON schema validation + confidence threshold filtering)
- Each step retries once on failure; if it fails again, the file is demoted to skipped

## Output Artifacts

Each review run produces output under `repo_root/.nightowl/review/<session_id>/`:

| File | Description |
|------|-------------|
| `files/*.md` | Structured review notes for each changed file |
| `summary.md` | Run-level summary: risk distribution, findings statistics, per-file risk ranking |
| `index.md` | Landing page linking all per-file notes and the summary |
| `manifest.json` | Machine-readable metadata: repo info, aggregate counts, per-file outcomes |
| `tool-audit.jsonl` | Tool usage audit log (every allow/deny decision) |
| `skipped.md` | Record of files skipped due to failure |

**Per-file note structure:**

```md
# path/to/file.ts

- Source file: `path/to/file.ts`

## Overview
## Dependencies & Boundaries
## Knowledge & Source of Truth
## Strategy & What-if Scenarios
## Findings
## Summary
```

## Architecture Overview

```
src/
├── bin/            CLI entry point
├── cli/            CLI argument parsing → RunRequest
├── app/            ReviewApp: composition root, wires all dependencies
├── core/
│   ├── orchestrator.ts    Flow control: Step 0 → path planning → bounded concurrency fan-out → Step 1–7
│   ├── step-runner.ts     Step execution layer: execute + completion check + retry
│   ├── steps/             Step 1–7 strategy modules
│   ├── file-review-context.ts   Single-file source of truth
│   ├── finalizer.ts       Review notes Markdown rendering
│   └── ...                Run-level finalizers, risk-level, path resolver, etc.
├── providers/      External I/O adapters (Git, Workspace, Config)
└── services/       Copilot SDK session management, Judge, Knowledge (MCP), Tool Policy Guard
```

**Core design principles:**

- **Separation of concerns**: CLI parsing → App dependency wiring → Orchestrator flow control → Provider I/O → Service SDK encapsulation
- **`FileReviewContext` is the single source of truth**: on-disk notes are snapshot projections only; they must not be read back
- **Completion check precedes state update**: Agent responses must pass judge/validation before being written to context
- **Repo source tree is read-only to Agent tools**: NightOwl host writes review artifacts only under `repo_root/.nightowl/review/**`

## Configuration

Place an optional configuration file at `repo_root/.nightowl/reviewconfig.json`:

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
| `confidenceThresholds.must` | `80` | Confidence threshold for must-fix findings |
| `confidenceThresholds.nice` | `90` | Confidence threshold for nice-to-have findings |
| `mcpServers` | `{}` | Custom MCP Servers (local/stdio or http/sse) |
| `webFetchAllowedHosts` | — | `web_fetch` host allowlist |
| `webFetchDeniedHosts` | — | `web_fetch` host denylist (deny-over-allow) |

File filtering uses `repo_root/.nightowl/reviewignore` (`.gitignore` syntax).

## Development

### Local Development Workflow

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

See [TESTING.md](./TESTING.md) for tier decision criteria, test patterns, fixture catalog, and manifest maintenance rules.

### Run Locally Without Building

```bash
npm run review -- main feature-branch
```

### Implementation Notes

- Source code is in `src/` (TypeScript); published artifacts are in `dist/` (JavaScript)
- The toolchain uses Node.js native TypeScript support with no external build dependencies
- The `prepack` lifecycle script ensures `dist/` is rebuilt before `npm pack`
- Production install uses `npm pack` + `npm install -g`; for development use `npm link`

## Design Reference

The review pipeline is based on a structured Code Review SOP covering the following design dimensions:

| Dimension | Description |
|-----------|-------------|
| **Review Pipeline** | Multi-step SOP — the complete review flow from Overview to Summary |
| **Product Requirements** | CLI I/O specification, execution model, input/output contracts |
| **System Architecture** | Module partitioning, interface definitions, data flow |
| **Implementation Design** | State consistency, module boundaries, failure semantics |
| **Prompt Specification** | System/User Messages and completion check rules per step |
| **Tool Permissions** | Bash policy, output format, MCP integration specification |
