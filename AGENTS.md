# AGENTS.md — NightOwl App

NightOwl is a local Code Review CLI that uses the GitHub Copilot SDK to automate a multi-step Code Review SOP. Given two Git refs, it produces structured Markdown review reports.

## Setup

```bash
npm install        # Install dependencies
npm test           # Build + run all tests (primary verification command)
npm run build      # Produce dist/
npm run typecheck  # Type check (tsc --noEmit)
npm link           # Dev only: symlink the review command locally
```

Run locally without building:

```bash
npm run review -- main feature-branch
```

Node.js ≥ 22.7.0. The toolchain uses Node's native TypeScript execution with no external build dependencies.

## Architecture

```
src/
├── bin/review.ts          CLI entry point
├── cli/parser.ts          CLI parsing → RunRequest
├── index.ts               runCli(): error handling, exit code
├── app/review-app.ts      Composition root: wire all dependencies, lifecycle
├── core/
│   ├── orchestrator.ts    Core flow control
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
    ├── knowledge.ts                KnowledgeSvc: MCP configuration
    ├── tool-policy-guard.ts        Tool permission hook
    ├── tool-audit-writer.ts        JSONL audit log
    ├── web-fetch-hostname-classifier.ts
    └── web-fetch-redirect-resolver.ts
```

### Key Config Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript compiler configuration |
| `scripts/build.mjs` | ESBuild build script |
| `.reviewconfig.json` | Review runtime settings (optional, placed at repo root) |
| `.reviewignore` | File filtering (`.gitignore` syntax) |

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

## Testing

```bash
npm test                   # Full test suite (build first, then source test files)
npm run test:unit          # Run unit tests only
npm run test:integration   # Run integration tests only
npm run test:e2e           # Run e2e tests only
npm run test:watch         # Convenience watch mode outside the primary taxonomy contract
npm run test:coverage      # Convenience coverage run outside the primary taxonomy contract
```

Run a single test file (requires build first):

```bash
npm run build && node --test test/core/orchestrator.test.ts
```

- Primary test commands run `npm run build` first and then execute source test files under `test/`
- After modifying `src/`, always run `npm run build` first
- Test structure mirrors `src/`: `test/core/orchestrator.test.ts` corresponds to `src/core/orchestrator.ts`
- Follow TDD: write or update tests before implementing
- Uses the Node.js built-in test runner (`node:test`); no external test frameworks
- Tests inject stubs/mocks through interfaces; no external mocking frameworks
- Orchestrator tests are split across multiple files (`orchestrator-*.test.ts`), each focusing on specific behavior

See [TESTING.md](./TESTING.md) for the project test taxonomy (`unit / integration / e2e`), tier manifest, and intended usage.

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

- **Repo workspace is read-only**: the review process must not write to the repo workspace
- **Bash allowlist**: only read-only analysis commands are permitted (git queries, cat, ls, grep, etc.); write or side-effect operations are forbidden
- **Path boundaries**: bash path access is restricted to `repo_root` and `<output_base_dir>/review/**`
- **Shell composition syntax**: `;`, `&&`, `||`, background execution, and command substitution are forbidden; the only exception is read-only pipelines `|`
- **`web_fetch` security**: only public HTTP(S) URLs are allowed; hostname DNS classification, redirect verification, and host allowlist/denylist are all enabled
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
