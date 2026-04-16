# TESTING.md — Testing Guide

## Philosophy

NightOwl uses a three-tier test taxonomy: **unit**, **integration**, and **e2e**.

Design goals:

- **Explicit intent** — every test file belongs to exactly one tier, declared in the tier manifest
- **Fast feedback** — deterministic logic stays in unit tests; slow or stateful tests live in higher tiers
- **Complementary tiers** — lower tiers own deterministic detail; higher tiers verify boundaries and the published surface

If this document conflicts with the actual code, **the code is the source of truth**.

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

**Typical subjects:** CLI parser, risk derivation, config normalization, shell/web-fetch policy decision logic, Markdown finalizers, etc. See the `unit` array in `test/test-tier-manifest.json` for the full list.

### Integration

Boundary and collaboration tests between two or more modules, or between a module and a real external resource.

**Decision criteria — at least one holds:**

- Verifies the collaboration contract between two or more production modules
- Exercises a real external boundary (file system, Git CLI, temporary directories)
- Tests lifecycle behavior that spans multiple components (startup, shutdown, signal handling)
- Validates hook-level behavior where the system under test is a composition of real objects

**Typical subjects:** app lifecycle and graceful shutdown, orchestrator coordination, step runner retry, real Git/workspace provider operations, tool-policy guard hook behavior, etc. See the `integration` array in `test/test-tier-manifest.json` for the full list.

### E2E

Thin guardrails for the published CLI surface. These tests exercise the outermost user-facing contract.

**Decision criteria:**

- Tests the installed or runnable CLI entry point as a user would invoke it
- Verifies exit codes, stdout/stderr output, and error messages for success, failure, and interrupt paths

**Typical subjects:** installable `review` executable (`package-bin`), CLI success / fatal / interrupted paths (`run-cli`), CLI progress rendering (`run-cli-progress`), `--check` mode environment smoke test (`run-cli-check-smoke`).

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
npm run build && NIGHTOWL_RUN_CHECK_SMOKE=1 node --test test/cli/run-cli-check-smoke.test.ts
```

Use it only on a machine where GitHub Copilot CLI is installed, authenticated, and expected to respond successfully.

### Running a single test file

```bash
npm run build && node --test test/core/orchestrator-bounded-concurrency.test.ts
```

All primary commands run `npm run build` first. After modifying `src/`, always build before testing.

### Type checking test code

`npm test` type-checks `src/` during the build step but does not type-check test files. To verify both `src/` and `test/` with the full TypeScript compiler:

```bash
npm run typecheck
```

### Convenience commands

```bash
npm run test:watch         # Watch mode (outside the primary taxonomy contract)
npm run test:coverage      # Coverage run (outside the primary taxonomy contract)
```

These are developer conveniences, not the primary `unit / integration / e2e` entrypoints. They do not run `npm run build` first and do not go through the tier manifest verifier.

---

## Toolchain & Conventions

### Framework

- **Test runner:** Node.js built-in test runner (`node:test`)
- **Assertions:** `node:assert/strict`
- **Mocking:** Primarily hand-written fakes injected via constructor parameters. The built-in `mock` from `node:test` is used sparingly for cases that cannot be reached through injection (e.g., simulating module-level failures).

The project exclusively uses Node.js built-in test APIs. Do not introduce external test frameworks (Jest, Vitest, Mocha), assertion libraries, or mocking libraries (Sinon, `jest.fn()`).

### TypeScript execution

- Node.js ≥ 22.7.0 executes `.ts` test files directly via native type stripping
- Import paths use `.ts` extensions (e.g., `from "../../src/core/risk-level.ts"`)
- `tsconfig.json` includes `test/**/*.ts` — test code gets full type checking

### File naming and structure

- Test files end in `.test.ts` and live under `test/`
- Directory structure mirrors `src/`: for example, `test/core/orchestrator-bounded-concurrency.test.ts` tests `src/core/orchestrator.ts`
- When a single source module needs multiple focused test suites, they share a prefix: `orchestrator-abort.test.ts`, `orchestrator-bounded-concurrency.test.ts`, `orchestrator-output-failures.test.ts`, etc.
- `test/scripts/` contains tests for the build and manifest tooling itself
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

When fixture setup is expensive (e.g., wiring a full app composition), integration tests may use `describe()` with `before()` / `after()` from `node:test` to share setup and teardown across related assertions.

---

## Fixtures (`test/helpers/`)

Shared test utilities live in `test/helpers/`. These are fixture modules, not test suites — they are excluded from the tier manifest.

Fixtures follow the `create*Fixture()` / `build*Response()` naming convention. Browse the directory for the current list of helpers and their exports.

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
