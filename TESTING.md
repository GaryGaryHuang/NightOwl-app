# TESTING.md — Testing Guide

## Philosophy

NightOwl uses a three-tier test taxonomy: **unit**, **integration**, and **e2e**.

Design goals:

- **Explicit intent** — every test file belongs to exactly one tier, declared in the tier manifest
- **Fast feedback** — deterministic logic stays in unit tests; slow or stateful tests live in higher tiers
- **Complementary tiers** — lower tiers own deterministic detail; higher tiers verify boundaries and the published surface

---

## Taxonomy

Tier assignment is driven by **what the test verifies**, not by folder location.

### Unit

Fast, deterministic, logic-owner tests. A test is unit when it exercises a single module's logic in isolation, using only in-memory fakes.

**Decision criteria — all must hold:**

- Tests a single module's exported logic (pure functions, deterministic transformations)
- All collaborators are absent or replaced by hand-written fakes passed via constructor injection
- Runs entirely in-memory — no file system, network, child process, or real Git operations
- Deterministic: same input always produces the same output

**Typical subjects:** CLI parser, step prompt preparation, section contracts, findings validation, risk derivation, path planning, Markdown finalizers, config normalization, shell policy decision logic, web-fetch policy decision logic, hostname classifier, redirect resolver.

### Integration

Boundary and collaboration tests between two or more modules, or between a module and a real external resource.

**Decision criteria — at least one holds:**

- Verifies the collaboration contract between two or more production modules
- Exercises a real external boundary (file system, Git CLI, temporary directories)
- Tests lifecycle behavior that spans multiple components (startup, shutdown, signal handling)
- Validates hook-level behavior where the system under test is a composition of real objects

**Typical subjects:** app startup fail-fast and lifecycle, signal-driven graceful shutdown, orchestrator coordination (Step 0 → fan-out → finalizers), step runner retry and state application, real Git/workspace provider operations, review-session factory wiring, hook-level tool-policy guard behavior, app-visible web-fetch guardrails.

### E2E

Thin guardrails for the published CLI surface. These tests exercise the outermost user-facing contract.

**Decision criteria:**

- Tests the installed or runnable CLI entry point as a user would invoke it
- Verifies exit codes, stdout/stderr output, and error messages for success, failure, and interrupt paths

**Typical subjects:** installable `review` executable (`package-bin`), CLI success / fatal / interrupted paths (`run-cli`), `--check` mode environment smoke test (`run-cli-check-smoke`).

---

## Commands

### Primary tier entrypoints

```bash
npm test                   # Build + verify manifest + run ALL test files
npm run test:unit          # Build + run unit tests only
npm run test:integration   # Build + run integration tests only
npm run test:e2e           # Build + run e2e tests only
```

**When to use each:**

| Command | Use when... |
|---------|-------------|
| `test:unit` | Tight edit loops on deterministic logic |
| `test:integration` | Changing app, session, provider, or orchestrator boundaries |
| `test:e2e` | Changing the published CLI surface, installability, or end-user command behavior |
| `npm test` | Before finalizing any work (CI-equivalent gate) |

### Optional CLI smoke test

`review --check` has an environment-gated smoke test that talks to a real GitHub Copilot CLI environment. It is skipped by default so CI stays deterministic.

```bash
NIGHTOWL_RUN_CHECK_SMOKE=1 npm run build
NIGHTOWL_RUN_CHECK_SMOKE=1 node --test test/cli/run-cli-check-smoke.test.ts
```

Use it only on a machine where GitHub Copilot CLI is installed, authenticated, and expected to respond successfully.

### Running a single test file

```bash
npm run build && node --test test/core/orchestrator-bounded-concurrency.test.ts
```

All primary commands run `npm run build` first. After modifying `src/`, always build before testing.

### Convenience commands

```bash
npm run test:watch         # Watch mode (outside the primary taxonomy contract)
npm run test:coverage      # Coverage run (outside the primary taxonomy contract)
```

These are developer conveniences, not the primary `unit / integration / e2e` entrypoints.

---

## Toolchain & Conventions

### Framework

- **Test runner:** Node.js built-in test runner (`node:test`)
- **Assertions:** `node:assert/strict`
- **Mocking:** Hand-written fakes and stubs injected via constructor parameters

The project exclusively uses Node.js built-in test APIs. Do not introduce external test frameworks (Jest, Vitest, Mocha), assertion libraries, or mocking libraries (Sinon, `jest.fn()`).

### TypeScript execution

- Node.js ≥ 22.7.0 executes `.ts` test files directly via native type stripping
- Import paths use `.ts` extensions (e.g., `from "../../src/core/risk-level.ts"`)
- `tsconfig.json` includes `test/**/*.ts` — test code gets full type checking

### File naming and structure

- Test files end in `.test.ts` and live under `test/`
- Directory structure mirrors `src/`: for example, `test/core/orchestrator-bounded-concurrency.test.ts` tests `src/core/orchestrator.ts`
- When a single source module needs multiple focused test suites, they share a prefix: `orchestrator-abort.test.ts`, `orchestrator-bounded-concurrency.test.ts`, `orchestrator-output-failures.test.ts`, etc.
- Shared test utilities live in `test/helpers/` — these are fixture modules, not test suites

---

## Test Patterns

### Dependency injection via constructor

Production modules accept collaborators through option objects. Tests pass hand-written fakes that satisfy the same interface:

```ts
const stepRunner = new StepRunner({
  reviewSessionFactory: { async createSession() { /* fake */ } },
  judgeService: { async evaluate() { return { passed: true }; } },
});
```

### Recording pattern

When verifying call sequences or side effects, tests collect events into an array and assert the final shape:

```ts
const calls: string[] = [];
const fakeSink = {
  publishFileReview(r) { calls.push(r.filePath); },
};
// ... exercise the system ...
assert.deepStrictEqual(calls, ["a.ts", "b.ts"]);
```

### Test isolation

Each `test()` block constructs its own fixture and collaborators from scratch. Tests must not rely on execution order or shared state.

---

## Fixtures (`test/helpers/`)

Shared fixtures follow the `create*Fixture()` / `build*Response()` naming convention.

| File | Purpose |
|------|---------|
| `git-fixture.ts` | Create real temporary Git repos (main + feature branch) with `writeFile`, `commitAll`, `cleanup` |
| `orchestrator-fixture.ts` | Fake LLM responses for each SOP step; `detectStepId` routing by system message |
| `review-app-fixture.ts` | `buildSessionResponse` routing by system message |
| `review-session-runtime-contract-fixture.ts` | Recording client manager that captures `SessionConfig`; `createAssistantSession` |
| `step-runner-contract-fixture.ts` | Default `FileReviewContext` builder; `applySection`; `seedStep4Context` for prerequisite state |
| `finalizer-contract-fixture.ts` | Text assertions: `assertTextContainsAll`, `assertTextExcludesAll`, `assertTextContainsInOrder`, `assertBootstrapShape`, `assertFindingsStats`, `assertFindingsTitlesInOrder`, `assertTraceabilityForms`, `assertWarningBlock`, `assertWarningBlockAtEnd` |
| `completed-run-finalizer-contract-fixture.ts` | Factory functions for `Finding`, `SuccessfulFileOutcome`, `SkippedFileOutcome`, `OutputTarget` |
| `review-config-provider-contract-fixture.ts` | Wraps git fixture + `LocalReviewConfigProvider` for `repo_root/.nightowl/reviewconfig.json` testing |
| `workspace-provider-contract-fixture.ts` | Temporary directory `OutputTarget` fixture with `LocalWorkspaceProvider` |
| `tool-policy-fixture.ts` | Fake `HostnameClassifier` and `RedirectResolver` for `ToolPolicyGuard` tests |

---

## Tier Manifest

The source of truth for tier assignment is `test/test-tier-manifest.json`.

### Rules

- Every `.test.ts` file under `test/` appears exactly once
- Every entry belongs to exactly one tier: `unit`, `integration`, or `e2e`
- Paths are repo-root-relative, forward-slash only
- Arrays within each tier are sorted alphabetically for stable diffs
- `npm test` runs the manifest verifier before executing tests — a missing or misplaced file fails the build

### Adding a new test file

1. Write the test file under the appropriate `test/` subdirectory
2. Decide the tier by the decision criteria above (by intent, not by folder)
3. Add the repo-root-relative path to the correct tier array in `test/test-tier-manifest.json`
4. Keep the array sorted
5. Run `npm test` to verify the manifest is consistent
