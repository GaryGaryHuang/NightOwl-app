# NightOwl

> **Status:** Early development (v0.1.0) — APIs, output formats, and the command-line interface may change.

NightOwl is a local code review CLI powered by the [GitHub Copilot SDK](https://github.com/github/copilot-sdk). It drives an AI agent to automatically perform structured code reviews on Git changes and produce traceable Markdown review reports.

## Why NightOwl?

- **Structured**: every review follows the same multi-step workflow and output format
- **Traceable**: every finding maps to a specific file, line number, or diff hunk
- **Reproducible**: the same inputs produce a consistent review structure, not free-form conversation

The generated reports can serve as a starting point for self-review or human review.

---

## Getting Started

This section gets you from zero to your first review report. If you only want to try NightOwl without setting up Copilot, jump to [step 4](#4-run-your-first-review) and use `--dry-run`.

### 1. Check prerequisites

- **Node.js ≥ 22.18.0** (`node --version` to confirm)
- For real reviews, one of:
  - **Copilot mode (default)** — a GitHub account with a [GitHub Copilot](https://github.com/features/copilot) subscription, signed in via `nightowl auth login`
  - **BYOK mode** — a provider API key (OpenAI, Azure, or Anthropic) supplied via an environment variable. See [Model Provider](#model-provider)

### 2. Install the `nightowl` command

Install NightOwl globally from npm:

```bash
npm install -g @garyhuangdev/nightowl
```

Or run it without a global install:

```bash
npx @garyhuangdev/nightowl --check
```

To use a source checkout instead of the published npm package:

```bash
git clone https://github.com/GaryGaryHuang/NightOwl.git
cd NightOwl
npm install        # Install dependencies
npm run build      # Produce dist/
npm link           # Make the `nightowl` command available on your PATH
```

### 3. Authenticate (Copilot mode only)

Copilot mode is the default and requires a GitHub account with Copilot access. Run NightOwl's Copilot sign-in command once; it uses the Copilot runtime bundled with NightOwl, so a global `copilot` CLI is not required:

```bash
nightowl auth login
```

Then verify NightOwl can reach Copilot:

```bash
nightowl --check
```

This prints `GitHub Copilot is available.` on success.

You can also inspect the current auth status:

```bash
nightowl auth status
```

> `nightowl --check` only validates Copilot availability. It does **not** validate BYOK credentials, and it is **not** required before `--dry-run`.

### 4. Run your first review

```bash
nightowl main feature-branch
```

NightOwl prints progress to the terminal and writes the report under `.nightowl/review/<session_id>/` inside the repository. Open `index.md` in that folder to read the review.

---

## Usage

```bash
nightowl <base_ref> <head_ref> [--repo <path>] [--context <value>] [--dry-run]
nightowl --check
nightowl auth <login|status>
```

`base_ref` and `head_ref` are required; NightOwl reviews the changes from `base_ref` to `head_ref`.

| Flag | Description |
|------|-------------|
| `--repo <path>` | Path to the Git repository (default: current working directory) |
| `--context <value>` | Background context for the review (PR description, root cause, expected behavior, spec links). Repeatable |
| `--dry-run` | Run the pipeline locally without calling GitHub Copilot |
| `--check` | Check that GitHub Copilot is available, then exit |

Auth commands:

| Command | Description |
|---------|-------------|
| `nightowl auth login` | Sign in to GitHub Copilot using the Copilot runtime bundled with NightOwl |
| `nightowl auth status` | Print the current Copilot auth status |

**Examples:**

```bash
nightowl main feature-branch
nightowl main HEAD --repo /path/to/repo
nightowl main HEAD --context "Performance optimization PR" --context "https://link-to-spec"
nightowl main feature-branch --dry-run
```

Providing `--context` is recommended: NightOwl feeds it into the review as source-of-truth background (stated requirements, expected behavior, root cause, business context), which produces more relevant findings.

### Review Modes

| Mode | How to enable | Requires | Use it for |
|------|---------------|----------|------------|
| **Copilot** (default) | nothing — it's the default | Copilot subscription + `nightowl auth login` | Normal reviews |
| **BYOK** | set `modelProvider.kind: "byok"` in config | A provider API key in an env var | Using your own OpenAI/Azure/Anthropic credentials |

---

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

### Output Artifacts

Each run produces output under `<repo_root>/.nightowl/review/<session_id>/`:

| File | Description |
|------|-------------|
| `index.md` | **Start here.** Landing page with review overview, change context, and grouped per-file note links |
| `files/*.md` | Structured review notes for each file selected for review |
| `changeset-overview.md` | Run-level overview of the reviewed changeset |
| `tool-audit.jsonl` | Best-effort tool usage audit log for allow/deny decisions |

---

## Configuration

All configuration is optional. Place a configuration file at `<repo_root>/.nightowl/reviewconfig.json`:

```json
{
  "maxConcurrentFiles": 5,
  "modelProvider": {
    "kind": "copilot"
  },
  "mcpServers": {},
  "webFetchAllowedHosts": ["docs.example.com", "*.github.com"],
  "webFetchDeniedHosts": ["internal.corp.com"]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxConcurrentFiles` | `5` | Number of files processed in parallel |
| `modelProvider` | Copilot mode with `gpt-5.4-mini` | Review model provider configuration |
| `mcpServers` | `{}` | Additional [MCP](https://modelcontextprotocol.io/) servers the AI agent can access during review |
| `webFetchAllowedHosts` | — | Hosts the AI agent may fetch from via HTTPS during review |
| `webFetchDeniedHosts` | — | Hosts blocked from AI agent HTTPS fetches; deny rules override allow rules |

To exclude files from review, add a `<repo_root>/.nightowl/reviewignore` file using `.gitignore` syntax.

### Model Provider

Use explicit Copilot mode to keep using your Copilot sign-in while overriding the model:

```json
{
  "modelProvider": {
    "kind": "copilot",
    "model": "gpt-5.4-mini"
  }
}
```

Use BYOK mode to send review sessions through a configured provider:

```json
{
  "modelProvider": {
    "kind": "byok",
    "type": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-5.4-mini",
    "apiKeyEnv": "OPENAI_API_KEY"
  }
}
```

BYOK fields:

| Field | Required | Description |
|-------|----------|-------------|
| `kind` | Yes | Must be `byok` for BYOK mode |
| `type` | Yes | Provider type: `openai`, `azure`, or `anthropic` |
| `baseUrl` | Yes | Provider API endpoint URL |
| `model` | Yes | Model name used for every review session |
| `reasoningEffort` | No | Provider-specific effort string |
| `apiKeyEnv` | One credential required | Environment variable name containing the provider API key |
| `bearerTokenEnv` | One credential required | Environment variable name containing a bearer token; takes precedence over `apiKeyEnv` when both are configured |
| `wireApi` | No | OpenAI/Azure wire API: `completions` or `responses` |
| `azure.apiVersion` | No | Azure API version when using `type: "azure"` |

> **Never** put secret values in `.nightowl/reviewconfig.json`. Store them in environment variables (e.g. `OPENAI_API_KEY`) and set only the variable **name** in the config (`apiKeyEnv` / `bearerTokenEnv`).

---

## How It Works

NightOwl runs a three-stage review pipeline:

1. **Changeset Overview**: scans the entire changeset once to build global context (scope of changes, cross-file relationships, user-provided context).
2. **Per-file semantic review**: NightOwl runs four steps for each file selected for review: Review Basis, Candidate Findings, Semantic Validation, and Review Summary. Semantic Validation can send a file back through Candidate Findings before Review Summary when more evidence is needed. Files are processed in parallel with bounded concurrency (default 5), while steps remain strictly sequential within each file.
3. **Run-level finalization**: writes the index with review overview, change context, and grouped per-file sections after every file selected for review finishes.

Each per-file step attempt runs in its own Copilot SDK session and must pass deterministic validation before NightOwl uses the result. Per-file steps use three total attempts; if a step fails after those attempts, the file is skipped.

---

## Development

> This section is for contributors building on or extending NightOwl. If you just want to run reviews, see [Getting Started](#getting-started).

NightOwl is written in TypeScript (strict mode, ESM). Tests use the Node.js built-in test runner (`node:test`).

```bash
npm install          # Install dependencies
npm run build        # Produce dist/
npm link             # Symlink the built `nightowl` command locally
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

Run locally without building (uses the source entry point directly):

```bash
npm run nightowl -- main feature-branch
```

See [TESTING.md](https://github.com/GaryGaryHuang/NightOwl/blob/main/TESTING.md) for tier decision criteria, test patterns, fixture catalog, and manifest maintenance rules.

### Architecture

```
src/
├── bin/            CLI entry point
├── cli/            CLI argument parsing → RunRequest
├── app/            Composition root: dependency wiring, lifecycle, signal handling
├── core/           Business logic: orchestrator, step runner, steps, finalizers
├── providers/      External I/O adapters (Git, filesystem, config)
└── services/       Copilot SDK session management, tool policy, MCP setup
```

See [AGENTS.md](https://github.com/GaryGaryHuang/NightOwl/blob/main/AGENTS.md) for detailed architecture, layer boundaries, and design rules.

## License

This project is licensed under the [MIT License](./LICENSE).
