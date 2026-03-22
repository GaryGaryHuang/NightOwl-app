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
- repo-native-first review-session foundation with built-in Context7 available across Step 0 and Step 1–7
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
- Repo-local `.reviewconfig.json` `maxConcurrentFiles` wiring with documented default `5`
- bounded concurrency between planned files while keeping Step 1–7 sequential inside each file
- structured successful-snapshot output health assessment during the post-bootstrap per-file worker phase, plus shared-output abort coordination for shared output target faults
- Minimal per-file review state and note rendering for bootstrap, Step 1, Step 2, Step 3, Step 4, Step 5, Step 6, and Step 7 snapshots
- Deterministic interrupted-note warning blocks and `skipped.md` records when Step 1–7 exhaust retry
- Minimal session foundation for Copilot SDK integration
- Minimal Step 0 guardrails for `read`, `bash`, and `write`

The app does **not** yet implement:

- broader external-knowledge tooling beyond the current built-in Context7 review-session rollout
- `web_fetch` / URL permission-policy integration
- user-defined MCP merge
- rollback / retry / recovery behavior beyond the current shared-output abort coordination foundation
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
- The current Step 1 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7 foundation now includes skipped-file downgrade for Step 1–7 exhaustion, a conservative output-failure taxonomy foundation, structured successful-snapshot output health assessment during the post-bootstrap per-file worker phase, shared-output abort coordination for concurrent shared output target faults, a deterministic run-level aggregate summary foundation, a deterministic review index foundation, completed-run artifact surface exposure in the CLI, repo-local `confidenceThresholds` wiring for Step 5 / Step 6 deterministic filtering, repo-local `maxConcurrentFiles` wiring for bounded per-file concurrency, and built-in Context7 review-session rollout through `KnowledgeSvc`: Step 0 and Step 1–7 review sessions are now repo-native-first with built-in Context7 available only when genuine knowledge gaps remain, judge sessions remain MCP-free, `web_fetch` stays excluded, user-defined MCP wiring is still deferred, Step 1–4 and Step 7 remain judge-backed section-steps, Step 4 remains strategy-only, Step 5 remains first-pass findings only, Step 6 remains findings-finalization only, Step 7 remains per-file-summary only, retry once is enabled, invalid `.reviewconfig.json` values for supported fields fail the run before Step 0 begins, missing config falls back to the documented `must=80` / `nice=90` thresholds and `maxConcurrentFiles=5`, built-in Context7 API key pass-through is optional via `CONTEXT7_API_KEY`, output target planning and bootstrap notes still complete before any file enters Step 1, single-file Step 1–7 execution remains sequential, successful snapshot write failures only downgrade a file to skipped when the output boundary can positively classify them as file-local and the interrupted snapshot plus skipped record still succeed, ambiguous or failed successful-snapshot assessments conservatively fall back to shared output target faults, same-process concurrent skipped writes are serialized enough to keep each record intact, shared output target faults now stop new file dispatch and make active siblings stop at safe boundaries without writing new per-file output, `initializeRun()` / bootstrap note publish remain pre-fan-out fatal paths, `publishRunSummary()` / `publishReviewIndex()` remain run-finalization fatal paths, completed runs publish `summary.md` and then `index.md` after all per-file artifacts are finalized, CLI success output reports the deterministic `Output`, `Files`, `Summary`, `Index`, and `Skipped` paths plus planned/successful/skipped counts directly from the completed-run result without reading artifacts from disk, Step 0 remains fatal, and rollback / retry / recovery plus broader external-knowledge tooling beyond the current built-in Context7 rollout remain deferred.

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
