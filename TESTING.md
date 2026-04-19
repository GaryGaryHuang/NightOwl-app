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

**Typical subjects:** installable `review` executable (`package-bin`), `--check` mode environment smoke test (`run-cli-check-smoke`).

**E2E scope clarification.** E2E is reserved for tests that exercise the installed or published binary surface — currently `package-bin` and `run-cli-check-smoke`. Non-binary CLI tests that invoke `runCli()` in-process (and therefore share the Node.js test process with the system under test) belong to **integration**, not e2e. A test that spawns a subprocess but does not exercise the published binary (for example, spawning a script under `scripts/` to verify its CLI entrypoint) is also **integration**, not e2e. The recent test-architecture refactor moved `test/cli/run-cli.test.ts` and `test/cli/run-cli-progress.test.ts` from e2e to integration accordingly; the manifest in `test/test-tier-manifest.json` reflects this.

### Healthy tier shape

Expect an inverted pyramid: most files are **unit**, a smaller band are **integration**, and **e2e** is reserved for the installed-binary surface (currently 2 files: `package-bin` and `run-cli-check-smoke`). New e2e additions are expected to be rare; adding a third e2e file should be treated as a tier change and require the same justification described under [Hold-The-Line Rules](#hold-the-line-rules).

---

## Ownership Model

Each behavior should have exactly one owner layer. Lower layers own deterministic detail; higher layers own wiring, lifecycle, and the published surface. When a contract can be expressed at more than one layer, it belongs to the **lowest** layer that can express it.

| Layer | Owns | Does Not Own | Representative Suites |
|---|---|---|---|
| App integration | startup guards, lifecycle wiring, dry-run published surface, minimal MCP startup failure wiring | progress event ordering, web-fetch policy matrix, report/markdown body formatting, lower-level session config shape | [test/app/run-lifecycle-manager.test.ts](test/app/run-lifecycle-manager.test.ts), focused `review-app-*` suites |
| CLI | argv grammar, top-level dispatch, exit-code mapping, binary/package smoke, pure CLI presentation helpers under `src/cli/` (e.g. risk-badge formatters) | internal reducer details, report/markdown body formatters owned by finalizers, non-binary tests labeled as e2e | [test/cli/parser.test.ts](test/cli/parser.test.ts), [test/cli/package-bin.test.ts](test/cli/package-bin.test.ts), [test/cli/run-cli-check-smoke.test.ts](test/cli/run-cli-check-smoke.test.ts) |
| Orchestrator | pre-dispatch lifecycle, abort boundary, bounded concurrency, snapshot fault policy, step dispatch, finalizer dispatch, progress event emission and ordering, failure aggregation | per-step analyzer logic, summary body rendering, index/manifest content formatting, markdown wording checks that belong to finalizers | `test/core/orchestrator-*.test.ts` |
| Steps | per-file analyzer logic, prompt assembly, structured-output validation per step | orchestration order, fan-out, abort plumbing, finalizer rendering | `test/core/steps/*.test.ts` |
| Finalizers and pure core | artifact content, sorting, formatting, outcome resolution, deterministic value logic | orchestration lifecycle and fan-out rules | `test/core/finalizers/*.test.ts`, focused pure core unit tests |
| Providers | parser semantics, path resolution, repo-local fallback, git/fs boundary behavior | duplicated lower-layer matrices at provider smoke level | `test/providers/*.test.ts` |
| Services | SDK adapter contracts, session lifecycle, review/judge session config, MCP merge/validation | app wiring smoke, whole-run lifecycle, top-level exit behavior | `test/services/*.test.ts` |
| Safety policy | shell policy, web-fetch policy, address classification, dual SDK surfaces, audit writing | repeated policy matrices in app or unrelated integration tests | `test/services/tool-policy-*.test.ts`, `test/services/web-fetch-*.test.ts` |
| Tooling and release | build, test-tier verification, package/install guardrails | internal helper detail not tied to a published tool contract | `test/scripts/*.test.ts`, [test/cli/package-bin.test.ts](test/cli/package-bin.test.ts) |

### Disambiguation cheatsheet

When a contract plausibly fits two layers, use these rules:

- **Within shell policy**, suites split by concern: `tool-policy-shell-policy-commands.test.ts` owns per-command allow/deny tables; `-composition.test.ts` owns chained / piped / sub-shell command parsing (`;`, `&&`, `|`, `$(...)`, backticks); `-paths.test.ts` owns path-argument and cwd-escape rules. Add chained-command bypass regressions (e.g. `git status; rm -rf .nightowl`) to `-composition`.
- **Within web-fetch policy**, the policy decision layer (`tool-policy-web-fetch-policy.test.ts`) owns allow/deny + reason, the classifier (`web-fetch-hostname-classifier.test.ts`) owns hostname parsing/classification, and `web-fetch-public-address-policy.test.ts` owns the address-range tables. Dual-surface tests (`tool-policy-guard-permission-handler.test.ts`, `tool-policy-guard-pre-tool-hook.test.ts`) keep only 1–2 representative cases per surface.
- **Adding a new tool surface**: a `tool-policy-<surface>.test.ts` integration suite covering allow / deny / audit MUST land before the surface is wired into app composition. App and orchestrator suites must not re-assert the policy matrix.
- **A test that wires the app but asserts orchestrator fan-out** belongs to the orchestrator suite (lower layer wins). The app suite gets a one-line composition smoke that proves the orchestrator is wired in.

### How to apply the "do not duplicate matrix" rule

The full input → output matrix for a behavior lives in exactly one suite — the lowest layer that can express it. Higher-layer tests get **at most one happy-path case and one failure-path case** to prove the wiring. Concretely:

- A new step's per-file analyzer matrix lives in `test/core/steps/<step>.test.ts` (unit). The orchestrator dispatch test gets one happy file and one failing file.
- A new policy's allow/deny matrix lives in `test/services/tool-policy-<surface>.test.ts`. The dual-surface guard tests get one allow + one deny per surface.
- A new finalizer's body-shape matrix lives in `test/core/finalizers/<finalizer>.test.ts`. The orchestrator suite asserts only that the finalizer was dispatched.

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

### Recommended inner-loop

While iterating on a single module:

```bash
npm run build && node --test test/<path>/<file>.test.ts
```

The build step is required after every `src/` edit — `node --test` does not rebuild. If you are iterating purely on a test file (no `src/` changes), you may re-run `node --test` directly without rebuilding.

If your test compiles individually but `npm test` reports a TypeScript error in an unrelated test file, run `npm run typecheck` — the per-tier runners do not type-check `test/`, so type errors in untouched files surface only via the full typecheck.

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

### Pre-push contract

Before opening a PR, run `npm test` at least once. It is the only command that runs the **tier manifest verifier**; `test:unit`, `test:integration`, `test:e2e`, `test:watch`, and `test:coverage` do not. Running only the convenience commands or a single tier can let you ship a stale build, an unregistered or misregistered test file, or a tier-manifest sort violation. Also run `npm run typecheck` whenever you have edited any `test/` file. PRs that fail either gate in CI will be bounced.

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

### When to extract a helper

Extract a helper into `test/helpers/` only when **at least two** test suites consume it. Single-consumer fixtures stay inline in the suite that uses them. A helper used by exactly one suite is a refactoring debt, not a fixture — wait for the second consumer before promoting it.

### Contract fixtures

When a production interface is implemented by hand-written fakes in multiple suites, place a single `*-contract-fixture.ts` under `test/helpers/` that exports a `create<Name>ContractFake()` typed against the production interface. Suites import the fake instead of redefining shapes inline. This keeps fake signatures from drifting when the production interface changes — the TypeScript build will fail in one place rather than silently passing in stale tests. See `test/helpers/review-session-runtime-contract-fixture.ts` and `test/helpers/step-runner-contract-fixture.ts` as canonical examples.

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

### Worked example

Suppose you added a pure helper `formatRiskBadge(level)` to `src/cli/format-risk-badge.ts`:

1. Create `test/cli/format-risk-badge.test.ts` (mirror the source path; the test file name matches the source file).
2. Add `"test/cli/format-risk-badge.test.ts"` to the `unit` array in `test/test-tier-manifest.json`, keeping the array alphabetically sorted.
3. Inner loop: `npm run build && node --test test/cli/format-risk-badge.test.ts`.
4. Before pushing: `npm test` (runs the manifest verifier + all tiers) and `npm run typecheck` (type-checks test files, which the tier runners skip).

If you forget step 2, `npm test` fails at the manifest verifier with a clear error pointing at the missing entry. Running `node --test <file>` directly will **not** catch this.

---

## Hold-The-Line Rules

These rules exist to prevent the test architecture from regrowing the maintenance debt that the refactor paid down. Reviewers should hold new contributions to them.

- **Suite size.** New test files should target ≤ 500 lines. Files between 500 and 700 lines require a justification in the PR description naming the single contract they cover and why splitting would fragment it. Files > 700 lines require explicit maintainer sign-off before merge. Splitting is the default; large suites are the exception.
- **Identify the owner before writing.** When adding tests for a new behavior, first identify which layer in the [Ownership Model](#ownership-model) owns the contract. Add the test there. Do not duplicate the same matrix (policy table, parser case set, formatter detail) across multiple layers — see [How to apply the "do not duplicate matrix" rule](#how-to-apply-the-do-not-duplicate-matrix-rule).
- **Prefer the lowest layer.** When in doubt about which layer should own a contract, prefer the **lowest** layer that can express it. Higher layers should verify wiring and boundaries, not re-verify deterministic logic that a unit test already pins down.
- **Do not change runtime behavior and tier classification in the same change.** Retiering is a taxonomy decision; behavior changes are product decisions. Keep them in separate commits or PRs unless the taxonomy fix is the explicit purpose of the change.
- **Tier-change PR checklist.** A PR that retiers tests should: (a) contain no `src/` diff; (b) include the manifest verifier output in the PR body; (c) explain why each moved file's intent matches the new tier per the decision criteria.
- **Helper extraction.** Do not introduce a helper into `test/helpers/` for a single consumer (see [When to extract a helper](#when-to-extract-a-helper)).

---

## Stable Anchor Suites

The following suites are already focused, well-owned examples of their layer's contract. They serve as **anchors** for the test architecture: contributors can read them as canonical examples, and they should generally not be churned during unrelated cleanup.

- [test/app/run-lifecycle-manager.test.ts](test/app/run-lifecycle-manager.test.ts)
- [test/cli/parser.test.ts](test/cli/parser.test.ts)
- [test/cli/package-bin.test.ts](test/cli/package-bin.test.ts)
- [test/cli/run-cli-check-smoke.test.ts](test/cli/run-cli-check-smoke.test.ts)
- [test/core/file-review-context.test.ts](test/core/file-review-context.test.ts)
- [test/core/review-path-resolver.test.ts](test/core/review-path-resolver.test.ts)
- [test/core/run-outcome-resolver.test.ts](test/core/run-outcome-resolver.test.ts)
- [test/core/finalizers/run-manifest-finalizer.test.ts](test/core/finalizers/run-manifest-finalizer.test.ts)
- [test/providers/local-git-provider.test.ts](test/providers/local-git-provider.test.ts)
- [test/providers/local-review-file-filter.test.ts](test/providers/local-review-file-filter.test.ts)
- [test/services/copilot-availability-checker.test.ts](test/services/copilot-availability-checker.test.ts)
- [test/services/knowledge.test.ts](test/services/knowledge.test.ts)
- [test/services/web-fetch-public-address-policy.test.ts](test/services/web-fetch-public-address-policy.test.ts)

If a refactor needs to touch one of these files, the burden of proof in code review is higher than usual:

- **Trivial edits exempt.** Pure cosmetic changes (formatting, import path updates, automated lint fixes) do not require justification.
- **Non-trivial edits.** Any rename, restructure, or change > 20 lines requires the PR description to (a) name the regression the change would have caught and (b) confirm that the contract under test still has exactly one owner layer.
