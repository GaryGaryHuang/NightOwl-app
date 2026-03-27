# TESTING.md — Testing Guide

NightOwl uses a three-tier test taxonomy:

- `unit`
- `integration`
- `e2e`

The goal is to make test intent explicit, keep day-to-day feedback fast, and avoid pushing lower-level deterministic detail back into high-level suites.

## Taxonomy

### Unit

Fast deterministic logic-owner tests.

Typical NightOwl examples:

- CLI parser behavior
- prompt preparation and section contracts
- findings validation
- risk derivation
- path planning
- markdown/render finalizers
- config normalization and validation
- shell and web-fetch policy decision logic

### Integration

Boundary and collaboration tests between modules.

Typical NightOwl examples:

- app startup fail-fast boundaries
- signal lifecycle and graceful shutdown
- app-visible runtime web_fetch guardrails
- orchestrator coordination
- step runner behavior across retries and state application
- git and workspace providers
- review-session factory wiring
- hook-level tool-policy guard behavior

### E2E

Thin published-surface guardrails.

Typical NightOwl examples:

- installable `review` executable
- CLI success / fatal / interrupted paths

## Tier Manifest

The source of truth is `test/test-tier-manifest.json`.

Rules:

- every tracked `.test.ts` file appears exactly once
- every suite belongs to exactly one of `unit`, `integration`, or `e2e`
- paths are repo-root-relative
- arrays are kept sorted for stable diffs

When adding a new test file:

1. Decide whether it is `unit`, `integration`, or `e2e` by intent, not just folder.
2. Add it to `test/test-tier-manifest.json`.
3. Keep the manifest and this guide aligned.

## Run Commands

Primary taxonomy entrypoints:

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
```

- use `test:unit` during tight edit loops on deterministic logic
- use `test:integration` when changing app, session, provider, or orchestrator boundaries
- use `test:e2e` when changing the published CLI surface, installability, or end-user command behavior
- use `npm test` before finalizing work

Convenience commands outside the primary taxonomy contract:

```bash
npm run test:watch
npm run test:coverage
```

- `test:watch` and `test:coverage` are convenience workflows, not the primary `unit / integration / e2e` entrypoints

## Baseline Snapshot

This is a short-term baseline snapshot for the current repo state. It is a static reference, not a live dashboard.

- Total `.test.ts` files: 52
- `unit` suites: 33
- `integration` suites: 17
- `e2e` suites: 2

Current major groupings:

- CLI:
  - `package-bin.test.ts` and `run-cli.test.ts` are `e2e`
  - `parser.test.ts` is `unit`
- App:
  - all `test/app/*.test.ts` suites are `integration`
- Core:
  - finalizers, validators, steps, and deterministic helpers are `unit`
  - orchestrator and step-runner boundary suites are `integration`
- Providers:
  - provider suites are `unit` except those that cross filesystem or Git boundaries (`local-git-provider`, `local-workspace-provider`), which are `integration`
- Scripts:
  - manifest verifier and targeted tier runner contract suites are `unit`
- Services:
  - direct policy and classifier/resolver suites are `unit`
  - review-session factory and hook-level guard suites are `integration`
