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
- run-level aggregate summary foundation for completed runs with four-tier risk distribution section and risk-sorted per-file lines
- review index foundation for completed runs with risk-sorted file entries and `[RiskLevel]`/`[Skipped]` indicators
- completed-run manifest foundation for completed runs with deterministic aggregate metadata, artifact paths, and planned-order per-file outcome records
- risk-level derivation (`deriveFileRiskLevel`) for the four-tier `High`/`Medium`/`Low`/`None` heuristic, exported from `src/core/risk-level.ts`
- enhanced per-file findings rendering with must-fix-before-nice-to-have grouping and summary statistics line
- completed-run artifact surface foundation for CLI success output
- SIGINT/SIGTERM graceful shutdown foundation: signal handler registration in app lifecycle layer, `AbortController`/`AbortSignal` propagation to orchestrator, `ReviewRunInterruptedError` distinct error type with `signal` property (`"SIGINT"` | `"SIGTERM"` | `undefined`), worker safe-boundary abort semantics reusing `runAbortState`, per-signal CLI exit codes (SIGINT → 130, SIGTERM → 143, unknown → 130) with distinct interrupt messages (`"Review run interrupted by SIGINT."` / `"Review run terminated by SIGTERM."` / `"Review run interrupted."`), and bounded post-start client teardown that falls back from `stop()` to `forceStop()` after a fixed timeout
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
- tool-use audit trail foundation: every tool decision (allow/deny) from review sessions is appended as a JSONL record to `tool-audit.jsonl` inside the run output directory; the audit path is exposed on the completed-run `OutputTarget`, surfaced in the CLI success output as `Tool Audit:`, and included in `manifest.json` artifacts

The app does **not** yet implement:

 - broader external-knowledge tooling beyond the current built-in Context7 plus validated local custom MCP plus redirect-aware web_fetch host-policy rollout
 - richer `web_fetch` / URL permission-policy integration beyond the current public-URL baseline plus redirect-aware host-policy foundation
- remote MCP support
- rollback / retry / recovery behavior beyond the current graceful shutdown foundation and shared-output abort coordination foundation (deferred: run resume/restart from checkpoint)
- full final review note rendering pipeline
- richer CLI / export surface beyond the current deterministic `outputTarget` artifact surface plus completed-run counts foundation and machine-readable manifest

Do not assume these missing capabilities already exist.

## Install And Run Contract

Prerequisites:

- Node.js >= 22.7.0 (the project uses `node:module` `stripTypeScriptTypes` for build and Node's native TypeScript execution for development)

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
 - The current Step 1 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7 foundation now includes skipped-file downgrade for Step 1–7 exhaustion, a conservative output-failure taxonomy foundation, structured successful-snapshot output health assessment during the post-bootstrap per-file worker phase, shared-output abort coordination for concurrent shared output target faults, a deterministic run-level aggregate summary foundation, a deterministic review index foundation, a deterministic completed-run manifest foundation, completed-run artifact surface exposure in the CLI, repo-local `confidenceThresholds` wiring for Step 5 / Step 6 deterministic filtering, repo-local `maxConcurrentFiles` wiring for bounded per-file concurrency, and built-in Context7 plus validated local custom MCP plus redirect-aware web_fetch host-policy rollout through `KnowledgeSvc`: Step 0 and Step 1–7 review sessions are now repo-native-first with built-in Context7 plus validated `.reviewconfig.json` `mcpServers` merge available only when genuine knowledge gaps remain, judge sessions remain MCP-free, built-in `web_fetch` is now available to review sessions with an initial-request URL guardrail, bounded redirect preflight over `301` / `302` / `303` / `307` / `308` (fixed internal `5`-hop / `5000ms` budget), optional `.reviewconfig.json` `webFetchAllowedHosts` exact-host and wildcard-subdomain allowlist (`*.`-prefixed entries match any subdomain at any depth, exact and wildcard entries coexist via OR logic, empty allowlists deny all hosts), and optional `.reviewconfig.json` `webFetchDeniedHosts` exact-host and wildcard-subdomain denylist (same grammar as allowlist, evaluated after allowlist with deny-over-allow semantics, denylist-only config is valid and only blocks matching hosts from the baseline-allowed space); the initial URL and every resolved redirect target reuse the same baseline public-URL and host-policy checks, unresolved redirect traversal is denied conservatively, remote MCP support is still deferred, Step 1–4 and Step 7 remain judge-backed section-steps, Step 4 remains strategy-only, Step 5 remains first-pass findings only, Step 6 remains findings-finalization only, Step 7 remains per-file-summary only, Step 7 `## Summary` now uses the same `High` / `Medium` / `Low` / `None` risk vocabulary as run-level artifacts without introducing extra prompt-side risk inputs, `summary.md` / `index.md` / `manifest.json` still derive labels and paths directly from finalized formal findings plus the preplanned completed-run output target rather than Step 7 prose, a four-tier file risk-level heuristic (`High` / `Medium` / `Low` / `None`) is now derived from finalized findings and used to risk-sort `index.md` file entries and `summary.md` successful-file lines (stable within the same risk level by planned order), `[RiskLevel]` prefix indicators appear on every file entry in `index.md` and `summary.md` (`[Skipped]` for skipped files), `summary.md` includes a `## Risk Distribution` section with per-level counts, per-file findings sections in notes are now rendered with must-fix items grouped before nice-to-have items plus a summary statistics line (`N must-fix issue(s), M nice-to-have suggestion(s).`), empty findings now render as `- 無`, retry once is enabled, invalid `.reviewconfig.json` values for supported fields fail the run before Step 0 begins, missing config falls back to the documented `must=80` / `nice=90` thresholds, `maxConcurrentFiles=5`, empty custom MCP set, no repo-local host allowlist, and no repo-local host denylist, built-in Context7 API key pass-through is optional via `CONTEXT7_API_KEY`, output target planning and bootstrap notes still complete before any file enters Step 1, single-file Step 1–7 execution remains sequential, successful snapshot write failures only downgrade a file to skipped when the output boundary can positively classify them as file-local and the interrupted snapshot plus skipped record still succeed, ambiguous or failed successful-snapshot assessments conservatively fall back to shared output target faults, same-process concurrent skipped writes are serialized enough to keep each record intact, shared output target faults now stop new file dispatch and make active siblings stop at safe boundaries without writing new per-file output, `initializeRun()` / bootstrap note publish remain pre-fan-out fatal paths, `publishRunSummary()` / `publishReviewIndex()` / `publishRunManifest()` remain run-finalization fatal paths, completed runs publish `summary.md`, then `index.md`, then `manifest.json` after all per-file artifacts are finalized, CLI success output reports the deterministic `Output`, `Files`, `Summary`, `Index`, `Manifest`, `Tool Audit:`, and `Skipped` paths plus planned/successful/skipped counts directly from the completed-run result without reading artifacts from disk, Step 0 remains fatal, and rollback / retry / recovery plus DNS-based host classification / judge-session `web_fetch` beyond the current redirect-aware web_fetch host-policy foundation remain deferred.

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
