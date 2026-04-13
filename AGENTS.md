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
├── bin/review.ts          CLI entry point
├── cli/parser.ts          CLI parsing → RunRequest
├── cli/progress-reporter.ts  Runtime progress rendering for TTY/non-TTY CLI output
├── index.ts               runCli(): error handling, exit code
├── app/review-app.ts      Composition root: wire all dependencies, lifecycle
├── core/
│   ├── orchestrator.ts    Core flow control
│   ├── run-progress.ts    Structured runtime progress events emitted during a run
│   ├── step-runner.ts     Step execution: execute → completion check → retry
│   ├── steps/             Step 1–7 strategy modules (one file per step)
│   ├── file-review-context.ts   Single-file source of truth
│   ├── finalizer.ts       Review notes Markdown render
│   ├── run-summary-finalizer.ts
│   ├── review-index-finalizer.ts
│   ├── run-manifest-finalizer.ts
│   ├── review-path-resolver.ts  Output path planning & collision handling
│   ├── risk-level.ts      Four-tier risk derivation (High/Medium/Low/None)
│   ├── structured-output-validator.ts  Step 5/6 JSON validation
│   ├── judge.ts           JudgeService: Step 1–4, 7 completion check
│   └── changeset-overview-runner.ts   Step 0 execution
├── providers/             External I/O adapters
│   ├── local-git-provider.ts
│   ├── local-workspace-provider.ts
│   ├── local-review-config-provider.ts
│   └── review-*.ts        Interface definitions
└── services/              SDK session management
    ├── session-executor.ts         Copilot Client lifecycle
    ├── review-session-factory.ts   Review session creation
    ├── judge-session-factory.ts    Judge session creation
    ├── dry-run-session-factory.ts  Dry-run stub factories (no SDK calls)
    ├── knowledge.ts                KnowledgeSvc: MCP configuration
    ├── tool-policy-guard.ts        Tool permission hook
    ├── tool-audit-writer.ts        JSONL audit log
    ├── web-fetch-hostname-normalization.ts
    ├── web-fetch-public-address-policy.ts
    └── web-fetch-hostname-classifier.ts
```

### Key Config Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript typecheck / editor configuration (`noEmit`) |
| `tsconfig.build.json` | Publish build configuration for `src/** -> dist/**` |
| `scripts/build.mjs` | Thin build wrapper: clean `dist/`, invoke `tsc`, normalize bin permissions, verify artifact |
| `reviewconfig.json` | Review runtime settings (optional, placed at `repo_root/.nightowl/`) |
| `reviewignore` | File filtering (`.gitignore` syntax, placed at `repo_root/.nightowl/`) |

### Layer Boundaries

Strictly follow these layers. Do not merge or cross boundaries:

| Layer | Responsibility | Does NOT |
|-------|---------------|----------|
| `cli/` | Parse CLI input → `RunRequest` | Wire providers or handle lifecycle |
| `app/` | Composition root, lifecycle, signal handling | Contain business logic |
| `core/orchestrator` | Flow control: Step 0 → path planning → fan-out → Step 1–7 → finalizers | Assemble prompts or write to disk directly |
| `core/step-runner` | Step execution + completion check + retry | Mutate `FileReviewContext` or write to disk |
| `core/steps/*` | Define prompt profile and completion check type per step | Create sessions or configure MCP |
| `providers/` | External I/O (Git, file writing, config reading) | Contain business logic |
| `services/` | SDK session lifecycle, tool policy, MCP injection | Control flow |

### Key Design Rules

- **`FileReviewContext` is the single source of truth for each file.** On-disk notes are snapshot projections only; they must not be read back.
- **Completion check precedes state update.** Step responses must pass judge or deterministic validation before being written to `FileReviewContext`. The Orchestrator applies updates via `StepResult.applyTo(context)`.
- **Step 0 is run-level**, not a per-file step. It does not go through `StepRunner` and does not implement `ISopStep`.
- **Bounded concurrency**: files are processed in parallel (default 5); within each file, Steps 1–7 run strictly in sequence.
- **Retry once**: a failed step retries once; if it fails again, the file is demoted to skipped. A Step 0 failure aborts the entire run.
- **`--check` has highest CLI priority**: when `--check` is present (regardless of other arguments), the CLI runs a Copilot availability preflight and exits. No branch refs are required and the review pipeline is not entered. `--check` takes priority over `--dry-run`; when neither flag is present, the normal review flow runs.
- **Dry-run mode**: when `RunRequest.dryRun` is `true`, the Composition Root substitutes `DryRunReviewSessionFactory` and `DryRunJudgeSessionFactory` for all AI calls and skips `clientManager.start()` / `stop()`. All non-AI pipeline stages run identically.
- **CLI runtime progress is event-driven**: `ReviewOrchestrator` emits structured progress events, and the CLI renders them as TTY live output or non-TTY append-only snapshots.

## Testing

```bash
npm test                   # Build + verify manifest + run all tests
npm run test:unit          # Run unit tests only
npm run test:integration   # Run integration tests only
npm run test:e2e           # Run e2e tests only
npm run test:watch         # Convenience watch mode outside the primary taxonomy contract
npm run test:coverage      # Convenience coverage run outside the primary taxonomy contract
```

Run a single test file (requires build first):

```bash
npm run build && node --test test/core/orchestrator-bounded-concurrency.test.ts
```

- Primary test commands run `npm run build` first and then execute source test files under `test/`
- After modifying `src/`, always run `npm run build` first
- Test structure mirrors `src/`: for example, `test/core/orchestrator-bounded-concurrency.test.ts` corresponds to `src/core/orchestrator.ts`
- Follow TDD: write or update tests before implementing
- Uses the Node.js built-in test runner (`node:test`); no external test frameworks
- Tests inject hand-written fakes and stubs via constructor parameters; no external mocking frameworks
- Orchestrator tests are split across multiple files (`orchestrator-*.test.ts`), each focusing on specific behavior

See [TESTING.md](./TESTING.md) for tier decision criteria, test patterns, fixture catalog, and manifest maintenance rules.

## Code Conventions

- TypeScript strict mode
- Language: Traditional Chinese for prose and user-facing text; English for code identifiers and established terms
- Terminology follows existing project conventions (Traditional Chinese for prose, English for code identifiers and established terms such as `FileReviewContext`, `completion check`)
- Prefer minimal, explicit implementations; no speculative abstractions
- Do not create helpers or abstractions for one-time operations
- Do not perform refactors not explicitly requested by the task (extract function, rename, move files)
- Do not add docstrings, comments, or type annotations to unmodified code

## Guardrails — DO NOT bypass

These are product safety boundaries that must not be circumvented or relaxed:

- **Repo source tree is read-only to Agent tools**: the review process must not write outside `repo_root/.nightowl/review/**`
- **Shell allowlist**: only read-only analysis commands are permitted (git queries, cat, ls, grep, etc.); write or side-effect operations are forbidden
- **Path boundaries**: shell path access is restricted to the repo source tree and `repo_root/.nightowl/review/**`; `repo_root/.nightowl/reviewconfig.json` and `repo_root/.nightowl/reviewignore` remain App-managed inputs
- **Shell composition syntax**: `;`, `||`, background execution, and command substitution are forbidden. `|` and `&&` are allowed only if each command independently complies with the shell allowlist and path boundaries.
- **URL retrieval security** (`web_fetch` LLM tool / `url` SDK permission kind): only public HTTPS URLs are allowed; hostname DNS classification and host allowlist/denylist are enabled
- **Tool audit**: every tool decision (allow/deny) is logged to `tool-audit.jsonl`
- **Tool policy fail-closed**: if shell policy evaluation itself errors, conservatively deny and log
- **No silent privilege escalation**: do not smuggle new tool permissions into unrelated implementations

## Copilot SDK Notes

- Currently using `@github/copilot-sdk@^0.2.0`
- Before changing the SDK version, re-verify: runtime imports, session lifecycle, permission hooks, MCP config types, and test behavior
- Review sessions implement tool permission control via `hooks.onPreToolUse`

## Commit Guidance

- Use Conventional Commits
- Keep code changes and documentation changes in separate commits
- Prefer grouping a coherent feature increment into a single commit

## Verification Checklist

Before finalizing a change, confirm:

- [ ] Related tests have been added or updated
- [ ] `npm test` passes entirely
- [ ] README.md still reflects current behavior
- [ ] If install contracts, completed capabilities, or major safety boundaries changed, update this file
