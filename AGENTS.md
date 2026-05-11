# AGENTS.md — NightOwl App

NightOwl is a local Code Review CLI that uses the GitHub Copilot SDK to automate a multi-step Code Review SOP. Given two Git refs, it produces structured Markdown review reports.

## Setup

```bash
npm install        # Install dependencies
npm test           # Build + verify manifest + run all tests (primary verification command)
npm run build      # Produce dist/
npm run typecheck  # Type check (tsc --noEmit)
npm link           # Dev only: symlink the review command locally
```

Run locally without building:

```bash
npm run review -- main feature-branch
```

Node.js ≥ 22.7.0. Published artifacts are built with the repo-local TypeScript compiler via `tsconfig.build.json`; `tsconfig.json` remains the typecheck/editor config.

## Architecture

```
src/
├── bin/review.ts        CLI entry point
├── index.ts             runCli(): error handling, exit code
├── cli/                 CLI parsing (→ RunRequest) & progress rendering
├── app/                 Composition root: wire dependencies, lifecycle, signal handling
├── core/                Business logic
│   ├── orchestrator.ts  Flow control: Changeset Overview → path planning → fan-out → ReviewBasis → Candidate Findings → Semantic Validation → Review Summary → finalizers
│   ├── step-runner.ts   Step execution + completion check + retry
│   ├── steps/           Strategy modules for current per-file steps (ReviewBasis, Candidate Findings, Semantic Validation, and Review Summary)
│   └── finalizers/      Output renderers (review notes, index, embedded run summary)
├── providers/           External I/O adapters (Git, filesystem, config)
└── services/            SDK session lifecycle, tool policy, MCP injection
```

### Key Config Files

| File | Purpose |
|------|---------|
| `scripts/build.mjs` | Build wrapper: clean `dist/`, invoke `tsc`, normalize bin permissions, verify artifact |
| `<target_repo>/.nightowl/reviewconfig.json` | Review runtime settings (optional) |
| `<target_repo>/.nightowl/reviewignore` | File filtering (`.gitignore` syntax) |

### Layer Boundaries

Strictly follow these layers. Do not merge or cross boundaries:

| Layer | Responsibility | Does NOT |
|-------|---------------|----------|
| `cli/` | Parse CLI input → `RunRequest` | Wire providers or handle lifecycle |
| `app/` | Composition root, lifecycle, signal handling | Contain business logic |
| `core/orchestrator` | Flow control: Changeset Overview → path planning → fan-out → ReviewBasis → Candidate Findings → Semantic Validation → Review Summary → finalizers | Assemble prompts or write to disk directly |
| `core/step-runner` | Step execution + completion check + retry | Mutate `FileReviewContext` or write to disk |
| `core/steps/*` | Define prompt profile and completion check type per step | Create sessions or configure MCP |
| `providers/` | External I/O (Git, file writing, config reading) | Contain business logic |
| `services/` | SDK session lifecycle, tool policy, MCP injection | Control flow |

### Key Design Rules

- **`FileReviewContext` is the single source of truth for each file.** On-disk notes are snapshot projections only; they must not be read back.
- **User context enters through Changeset Overview.** Changeset Overview receives every ordered `RunRequest.userContext` entry and treats stated requirements, expected behavior, Root Cause, and business background as source-of-truth review context; ReviewBasis, Candidate Findings, Semantic Validation, and Review Summary consume the Changeset Overview projection and per-file review state unless an architecture change updates that contract.
- **Completion check precedes state update.** Step responses must pass judge or deterministic validation before being written to `FileReviewContext`. The Orchestrator applies updates via `StepResult.applyTo(context)`.
- **Deterministic validators enforce structure and contracts, not factual truth.** They gate parse/schema/coverage/placeholder and structured-output contracts before state mutation; prompt contracts own whether and when review judgments are made.
- **Steps are pluggable.** Each per-file step implements the minimal `StepDefinition` interface (`stepId` + `prepare()`). The Orchestrator receives steps via an injected `perFileStepsFactory`; adding, removing, or reordering steps does not require changes to the Orchestrator or StepRunner.
- **Changeset Overview is run-level**, not a per-file step. It does not go through `StepRunner` and does not implement `StepDefinition`.
- **Bounded concurrency**: files are processed in parallel (default 5); within each file, ReviewBasis, Candidate Findings, Semantic Validation, and Review Summary run strictly in sequence.
- **Retry once**: a failed step retries once; if it fails again, the file is demoted to skipped. A Changeset Overview failure aborts the entire run.

## Testing

```bash
npm test                   # Build + verify manifest + run all tests
npm run test:unit          # Build + verify manifest + run unit tests only
npm run test:integration   # Build + verify manifest + run integration tests only
npm run test:e2e           # Build + verify manifest + run e2e tests only
npm run test:watch         # Convenience watch mode outside the primary taxonomy contract
npm run test:coverage      # Convenience coverage run outside the primary taxonomy contract
```

Run a single test file (requires build first):

```bash
npm run build && node --test test/core/orchestrator-bounded-concurrency.test.ts
```

- Primary test commands run `npm run build` first, verify `test/test-tier-manifest.json`, and then execute source test files under `test/`
- After modifying `src/`, always run `npm run build` first
- Test structure mirrors `src/`: for example, `test/core/orchestrator-bounded-concurrency.test.ts` corresponds to `src/core/orchestrator.ts`
- Follow TDD: write or update tests before implementing
- Uses the Node.js built-in test runner (`node:test`); no external test frameworks
- Tests inject hand-written fakes and stubs via constructor parameters; no external mocking frameworks
- Orchestrator tests are split across multiple files (`orchestrator-*.test.ts`), each focusing on specific behavior

See [TESTING.md](./TESTING.md) for tier decision criteria, test patterns, fixture catalog, and manifest maintenance rules.

## Code Conventions

- TypeScript strict mode
- Review output language is configured in Step prompts (`common-system-message.ts`); currently set to Traditional Chinese. Users can change the output language by modifying Step prompt definitions without touching the framework.
- Framework-layer messages (CLI, logs, errors) are in English
- Code identifiers and established terms (e.g. `FileReviewContext`, `completion check`) are always in English
- Prefer minimal, explicit implementations; no speculative abstractions
- Do not create helpers or abstractions for one-time operations
- Do not perform refactors not explicitly requested by the task (extract function, rename, move files)
- Do not add docstrings, comments, or type annotations to unmodified code

## Guardrails — DO NOT bypass

These are product safety boundaries that must not be circumvented or relaxed:

- **Repo source tree is read-only to Agent tools**: the review process must not write outside `repo_root/.nightowl/review/**`
- **Shell allowlist**: only read-only analysis commands are permitted (git queries, cat, ls, grep, etc.); write or side-effect operations are forbidden
- **Path boundaries**: shell path access is restricted to the repo source tree and `repo_root/.nightowl/review/**`; `repo_root/.nightowl/reviewconfig.json` and `repo_root/.nightowl/reviewignore` remain App-managed inputs
- **Shell composition syntax**: `|`, `&&`, and `;` are allowed only if each command independently complies with the shell allowlist and path boundaries. `||`, background execution, command substitution, redirection, and non-read-only segments are forbidden.
- **URL retrieval security** (`web_fetch` LLM tool / `url` SDK permission kind): only public HTTPS URLs are allowed; hostname DNS classification and host allowlist/denylist are enabled
- **Tool audit**: every tool decision (allow/deny) is logged to `tool-audit.jsonl`
- **Tool policy fail-closed**: if shell policy evaluation itself errors, conservatively deny and log
- **No silent privilege escalation**: do not smuggle new tool permissions into unrelated implementations

## Copilot SDK Notes

- Using `@github/copilot-sdk@^0.3.0`. Before upgrading, re-verify: runtime imports, session lifecycle, permission hooks (`onPreToolUse`), MCP config types, and test behavior.

## Commit Guidance

- Use Conventional Commits
- Keep code changes and documentation changes in separate commits
- Prefer grouping a coherent feature increment into a single commit

## Verification Checklist

Before finalizing a change, confirm:

- [ ] Related tests have been added or updated
- [ ] `npm test` passes entirely
- [ ] `npm run typecheck` passes (covers `src/`, `test/`, and `scripts/`; `npm test` only type-checks `src/`)
- [ ] README.md still reflects current behavior
- [ ] If install contracts, completed capabilities, or major safety boundaries changed, update this file
