# NightOwl App Agent Guide

## Purpose

This repository contains the NightOwl application code. It is a local code review CLI built with the GitHub Copilot SDK.

Use this file as the execution guide for coding agents working in `NightOwl-app`.

## Current Product State

The app currently implements:

- CLI parsing for `review <base_ref> <head_ref> [--repo <path>] [--context <value>]`
- Local review run bootstrap
- Review output planning under `<output_base_dir>/review/<session_id>/`
- `.reviewignore` filtering
- Step 0 (Changeset Overview) execution
- `RunContext` creation and retention
- Step 1 (Overview) execution for each planned file
- Step 2 (Dependencies & Boundaries) execution for each planned file
- Step 3 (Knowledge & Source of Truth) local-first foundation for each planned file
- Step 4 (Strategy & What-if Scenarios) foundation for each planned file
- Step 5 (Validation & Interrogation) foundation for each planned file
- Step 6 (Cognitive Simulation) foundation for each planned file
- Step 7 (Summary) foundation for each planned file
- skipped-file pipeline foundation for Step 1–7 exhaustion
- output-failure taxonomy foundation for current bootstrap / snapshot / skipped-artifact output edges
- run-level aggregate summary foundation for completed runs
- review index foundation for completed runs
- completed-run artifact surface foundation for CLI success output
- Minimal `StepRunner` foundation for section-step execution
- Minimal `StructuredOutputValidator` foundation for findings JSON validation and confidence filtering
- `JudgeSessionFactory` and `JudgeService` for section-step completion checks
- Judge-based completion-check flow for Step 1, Step 2, Step 3, Step 4, and Step 7 with retry once semantics
- Deterministic validation flow for Step 5 and Step 6 findings JSON with repo-local `confidenceThresholds` overrides plus documented defaults
- Minimal per-file review state and note rendering for bootstrap, Step 1, Step 2, Step 3, Step 4, Step 5, Step 6, and Step 7 snapshots
- Deterministic interrupted-note warning blocks and `skipped.md` records when Step 1–7 exhaust retry
- Minimal session foundation for Copilot SDK integration
- Minimal Step 0 guardrails for `read`, `bash`, and `write`

The app does **not** yet implement:

- the full external-knowledge version of Step 3
- MCP / Context7 integration
- `web_fetch` / URL permission-policy integration
- `KnowledgeSvc`
- `maxConcurrentFiles` wiring from `.reviewconfig.json`
- bounded concurrency
- richer output-failure coordinator behavior beyond the current conservative taxonomy foundation
- full final review note rendering pipeline
- richer CLI / export surface beyond the current deterministic `outputTarget` artifact surface plus completed-run counts foundation

Do not assume these missing capabilities already exist.

## Install And Run Contract

Formal CLI installation:

- Use a published package or package artifact
- Current local verification path: `npm pack` then `npm install -g ./nightowl-<version>.tgz`

Local development workflow:

- `npm install`
- `npm link`

Do **not** treat `npm install -g .` as the product install contract.

## Development Rules

- Follow TDD. Add or update tests before finalizing implementation changes.
- Keep changes aligned with the current accepted OpenSpec change. Do not invent new product behavior outside that scope.
- If implementation reveals a design conflict, update the relevant OpenSpec artifacts before continuing.
- Preserve repo-specific guardrails:
  - `read` must stay within documented path boundaries
  - `bash` must stay read-only and within documented boundaries
  - arbitrary agent `write` operations must remain restricted
- Do not silently widen tool permissions.
- If a capability is explicitly deferred in the active change, do not “sneak it in” as part of unrelated implementation.
- The current Step 1 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7 foundation now includes skipped-file downgrade for Step 1–7 exhaustion, a conservative output-failure taxonomy foundation, a deterministic run-level aggregate summary foundation, a deterministic review index foundation, completed-run artifact surface exposure in the CLI, and repo-local `confidenceThresholds` wiring for Step 5 / Step 6 deterministic filtering: Step 1–4 and Step 7 remain judge-backed section-steps, Step 3 remains local-first, Step 4 remains strategy-only, Step 5 remains first-pass findings only, Step 6 remains findings-finalization only, Step 7 remains per-file-summary only, retry once is enabled, invalid `.reviewconfig.json` threshold config fails the run before Step 0 begins, missing threshold config falls back to the documented `must=80` / `nice=90` defaults, failed per-file steps publish warning-backed interrupted snapshots plus `skipped.md` records, completed runs publish `summary.md` and then `index.md` after all per-file artifacts are finalized, CLI success output reports the deterministic `Output`, `Files`, `Summary`, `Index`, and `Skipped` paths plus planned/successful/skipped counts directly from the completed-run result without reading artifacts from disk, `initializeRun()` / bootstrap note publish / successful snapshot publish / interrupted snapshot publish / `publishSkippedFile()` / `publishRunSummary()` / `publishReviewIndex()` failures remain fatal output-layer errors, Step 0 remains fatal, and `maxConcurrentFiles`, MCP / `KnowledgeSvc`, and bounded concurrency are still deferred.

## Copilot SDK Notes

- The app currently uses `@github/copilot-sdk@0.1.33-preview.2`
- This preview version is intentional because the stable version used during implementation was not compatible with the current Node 25 ESM environment
- If you change SDK versioning, you must re-check:
  - runtime imports
  - test behavior
  - the active OpenSpec design notes

## Verification

Primary verification command:

```bash
npm test
```

Before finishing a change, ensure:

- all relevant tests are updated
- `npm test` is green
- README still matches current runtime behavior
- `AGENTS.md` is updated if the install contract, completed capability set, or major guardrail boundary has changed

## Commit Guidance

- Use Conventional Commits
- Keep app code commits separate from `NightOwl-specs` commits
- Prefer commits that group one coherent functional increment

## Working Style Expectations

- Prefer minimal, explicit implementations over speculative abstractions
- Keep architecture boundaries clear:
  - CLI parses input
  - app boundary composes dependencies
  - orchestrator controls flow
  - providers handle external I/O
  - services encapsulate SDK lifecycle
- Do not collapse these layers just to save files
