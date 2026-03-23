# NightOwl

NightOwl is a local code review CLI built with the GitHub Copilot SDK.

The project is designed to review changes between two Git refs in a local repository, then produce structured review notes instead of a free-form chat response. Its goal is to make AI-assisted review more traceable, more repeatable, and easier to use as a starting point for human review.

## Current Status

The current repository implements the Step 0 + Step 1 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7 foundation stage. This stage provides:

- an installable `review` executable
- argument parsing for `review <base_ref> <head_ref> [--repo <path>] [--context <value>]`
- Step 0 (Changeset Overview) execution through the GitHub Copilot SDK before local bootstrap continues
- local Git-backed review run preparation, including repo root discovery and `.reviewignore` filtering
- review output path planning and initialization under `<output_base_dir>/review/<session_id>/`
- bootstrap note artifacts for each planned file before Step 1 runs
- Step 1 (Overview) execution for each planned file with `RunContext.changesetOverview` injected into the prompt
- Step 2 (Dependencies & Boundaries) execution for each planned file with `<current_review>` rendered from formal in-memory review state after Step 1 succeeds
- Step 3 (Knowledge & Source of Truth) execution for each planned file using a repo-native-first evidence contract after Step 2 succeeds, with built-in Context7 MCP available when genuine external knowledge gaps remain
- Step 4 (Strategy & What-if Scenarios) execution for each planned file after Step 3 succeeds, producing scenario-driven validation strategy from the accumulated review state
- Step 5 (Validation & Interrogation) execution for each planned file after Step 4 succeeds, producing first-pass findings through deterministic JSON validation and confidence filtering
- Step 6 (Cognitive Simulation) execution for each planned file after Step 5 succeeds, consuming first-pass findings and overwriting them with final findings through deterministic JSON validation and confidence filtering
- Step 7 (Summary) execution for each planned file after Step 6 succeeds, producing a reader-facing audit trail section from the completed review note
- judge-based completion checks for Step 1, Step 2, Step 3, Step 4, and Step 7, so section content is written only after the judge passes
- deterministic validation plus confidence filtering for Step 5 and Step 6 findings JSON before formal findings state is updated, with repo-local `.reviewconfig.json` support for `confidenceThresholds`
- repo-local `.reviewconfig.json` support for `maxConcurrentFiles`, with default `5`, same-run coexistence with `confidenceThresholds`, and fail-fast validation before Step 0 begins
- per-file in-memory review state plus minimal note rendering for bootstrap, Step 1, Step 2, Step 3, Step 4, Step 5, Step 6, and Step 7 snapshots
- bounded concurrency between planned files through a per-file worker pool, while each single file still executes Step 1 through Step 7 in order
- skipped-file pipeline foundation for Step 1–7 exhaustion: if a section-step attempt or its judge check fails twice, or if Step 5 / Step 6 review or deterministic validation fails twice, that file is downgraded to skipped, its last successful formal snapshot is preserved with a deterministic warning block, one record is appended to `skipped.md`, and later planned files continue
- output-failure taxonomy foundation for current local output edges: `initializeRun()`, bootstrap note publish, interrupted snapshot publish, and `publishSkippedFile()` failures remain fatal output-layer errors, while successful snapshot publish failures are first health-assessed during the post-bootstrap per-file worker phase and only downgrade to skipped when the output boundary can positively classify them as file-local
- shared-output abort coordination foundation for concurrent per-file processing: output failures are now classified by blast radius through structured output-boundary assessment, so successful snapshot write failures that are classified as file-local can downgrade a single file to skipped, while shared output target faults or inconclusive successful-snapshot assessments stop new file dispatch, preserve first shared-error ownership, and make active sibling workers stop at safe boundaries without writing new per-file output
- run-level aggregate summary foundation for completed runs: the app now writes deterministic `summary.md` with planned / successful / skipped counts, final findings totals from successful files only, and planned-order successful / skipped file lists
- review index foundation for completed runs: the app now writes deterministic `index.md` as a landing page that links `summary.md`, `skipped.md`, and every planned per-file note in planned order
- completed-run artifact surface foundation for CLI success output: the success summary now prints the deterministic `Output`, `Files`, `Summary`, `Index`, and `Skipped` paths plus planned / successful / skipped counts directly from the completed-run result
- minimal interruption-state rendering so skipped files keep bootstrap, Step 1, Step 4, or Step 6 snapshots without leaking provisional failed-step content

The full AI review orchestration is not implemented yet. This repository now includes the Step 7 foundation on top of repo-native-first review sessions with built-in Context7 available across Step 0 and Step 1–7, validated repo-local custom MCP merge through `.reviewconfig.json` `mcpServers`, built-in `web_fetch` for review sessions with an initial-request URL guardrail plus optional repo-local exact-host and wildcard-subdomain allowlist through `.reviewconfig.json` `webFetchAllowedHosts` and optional repo-local exact-host and wildcard-subdomain denylist through `.reviewconfig.json` `webFetchDeniedHosts` with deny-over-allow evaluation order, Step 4 strategy foundation, Step 5 first-pass findings foundation, Step 6 findings-finalization foundation, repo-local `confidenceThresholds` wiring for deterministic findings filtering, repo-local `maxConcurrentFiles` wiring with bounded per-file concurrency, the skipped-file pipeline foundation for Step 1–7 exhaustion, the conservative output-failure taxonomy foundation for current output edges, the shared-output abort coordination foundation for concurrent per-file output failures, the deterministic run-level aggregate summary foundation, the deterministic review index foundation, and the completed-run artifact surface foundation. Remote MCP support, judge-session `web_fetch`, wildcard host matching, redirect / DNS-based URL policy, rollback / retry / recovery for output failures, and the complete final rendering / export pipeline are still deferred.

## Current Behavior

After installation, a valid command now requires a working GitHub Copilot CLI login, executes Step 0 (Changeset Overview), resolves run-level review config from `repo_root/.reviewconfig.json`, completes deterministic bootstrap for all planned files, and then runs Step 1 (Overview), Step 2 (Dependencies & Boundaries), Step 3 (Knowledge & Source of Truth), Step 4 (Strategy & What-if Scenarios), Step 5 (Validation & Interrogation), Step 6 (Cognitive Simulation), and Step 7 (Summary) for each planned file through bounded per-file concurrency, while keeping each single file's steps sequential, before reporting the same stable run summary:

```bash
review main feature-branch
```

```text
Initialized local review run.
Repo root: /path/to/repo
Output: /path/to/repo/review/feature-branch_03131430
Files: /path/to/repo/review/feature-branch_03131430/files
Summary: /path/to/repo/review/feature-branch_03131430/summary.md
Index: /path/to/repo/review/feature-branch_03131430/index.md
Skipped: /path/to/repo/review/feature-branch_03131430/skipped.md
Planned files: 3
Successful files: 2
Skipped files: 1
```

The command also creates:

- `<output_base_dir>/review/<session_id>/`
- `<output_base_dir>/review/<session_id>/files/`
- `<output_base_dir>/review/<session_id>/skipped.md`
- `<output_base_dir>/review/<session_id>/summary.md`
- `<output_base_dir>/review/<session_id>/index.md`
- one Markdown note per planned file

For successfully processed files, the note is updated from the bootstrap skeleton into a Step 1 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7 snapshot that begins with:

```md
# path/to/file.ts

- Source file: `path/to/file.ts`

## Overview
...

## Dependencies & Boundaries
...

## Knowledge & Source of Truth
...

## Strategy & What-if Scenarios
...

## Findings
...

## Summary
...
```

Invalid input still fails fast with a usage error, and successful runs with zero planned files still exit successfully.

At this stage, Step 1, Step 2, Step 3, Step 4, and Step 7 all use Judge completion checks with retry once semantics, while Step 5 and Step 6 use deterministic JSON validation with the same retry-once exhaustion model. If a per-file Step 1–7 still fails after retry, that file is marked skipped, `skipped.md` receives one deterministic record, the note keeps only the last successful formal snapshot plus:

```md
> [!WARNING] Review Interrupted
> 本檔案在執行 <stepId> 時失敗（原因：<reason>），後續審查已略過。
```

Later planned files still continue. Step 0 remains run-fatal and does not use skipped-file downgrade.

At the current orchestration boundary, concurrency exists only between planned files. `planNoteFiles(...)`, output target planning, and bootstrap note publication still finish before any file enters Step 1. Formal successful / skipped outcomes, `summary.md`, and `index.md` all remain planned-order artifacts even when worker completion order differs. `skipped.md` remains an append-only log rather than a planned-order report, but same-process concurrent skipped writes are serialized enough to keep each record intact.

At the current foundation boundary, output-layer failures are now classified by blast radius. During the post-bootstrap per-file worker phase, a successful step snapshot write failure first goes through structured output-boundary health assessment. The file only downgrades to skipped when that assessment can positively classify the failure as file-local and the interrupted snapshot plus skipped record can still be written. If the runtime instead reaches a shared output target fault, or if the assessment is inconclusive, or if interrupted snapshot / skipped-record publication itself fails, the run aborts with the underlying output error, no new planned file starts after that point, and active sibling workers stop at safe boundaries without publishing new per-file output. This contract still applies when `maxConcurrentFiles = 1` but later planned files have not started yet. Bootstrap (`initializeRun()` / bootstrap note publish) and run-finalization (`summary.md` / `index.md`) fatal paths remain unchanged. This still does **not** introduce rollback, retry, recovery, or in-flight session cancellation.

For completed runs, the app now also writes a deterministic run-level `summary.md` after all per-file notes and skipped artifacts are finalized. That artifact includes run metadata, planned / successful / skipped counts, final findings totals from successful files only, a `## Successful Files` section, and a `## Skipped Files` section. Zero-file runs still produce `summary.md` with explicit `- 無` sections. Fatal runs do not publish `summary.md`, and if writing `summary.md` itself fails, the run aborts with the underlying output error.

For the same completed runs, the app now also writes a deterministic `index.md` after `summary.md` succeeds. That artifact is a landing page rather than a second aggregate report: it links `summary.md`, `skipped.md`, and every planned file note in planned order, including collision-resolved note names under `files/`. Zero-file runs still produce `index.md` with `## File Notes` rendered as `- 無`. Fatal runs do not publish `index.md`, and if writing `index.md` itself fails after `summary.md` is already written, the run still aborts with the underlying output error.

The CLI success summary now aligns with the completed-run artifact surface and accounting used by the app boundary: it prints `Output: <basePath>`, `Files: <filesPath>`, `Summary: <summaryPath>`, `Index: <indexPath>`, `Skipped: <skippedPath>`, `Planned files`, `Successful files`, and `Skipped files` directly from the completed-run result without reading artifacts from disk. It still does **not** introduce a richer export surface such as manifests, ZIP/HTML export, or output-directory scanning. All-successful runs, mixed-result runs, all-skipped runs, and zero-file runs all remain successful completed runs as long as no fatal runtime error occurs.

Review sessions in the current repository are intentionally **repo-native-first with built-in Context7, validated custom MCP, and built-in `web_fetch` support**: Step 0 and Step 1–7 may use built-in Context7 MCP, validated repo-local custom MCP, and built-in `web_fetch` only when genuine knowledge gaps remain after repo-native / local evidence is exhausted, while still preferring local files, git evidence, config, internal docs, and project conventions first. `web_fetch` currently uses an initial-request URL guardrail that allows only absolute public `http:` / `https:` URLs and denies malformed URLs, scheme-less host strings, non-HTTP(S) schemes, `localhost`, and private / loopback / link-local IP literals. When `.reviewconfig.json` defines `webFetchAllowedHosts`, review sessions further require the parsed hostname (port excluded) to match an entry: exact entries use direct lowercase comparison after trailing-dot normalization; `*.`-prefixed entries match any subdomain at any depth (e.g. `*.example.com` matches `docs.example.com` and `api.docs.example.com` but not `example.com` itself); exact and wildcard entries coexist in the same array via OR logic. Empty allowlists are valid and deny all `web_fetch` hosts. When `.reviewconfig.json` also defines `webFetchDeniedHosts`, review sessions additionally evaluate the parsed hostname against the denylist after the allowlist check passes; a hostname matching any denylist entry is denied regardless of allowlist match, following deny-over-allow evaluation order. Denylist entries use the same grammar as allowlist entries (exact-host or `*.`-prefixed wildcard) and the same comparison rules (case-insensitive, trailing-dot canonicalization, port excluded). Denylist-only config (no allowlist) is valid and only blocks matching hosts from the otherwise unrestricted baseline space. This foundation still does **not** enable redirect validation, DNS-based host classification, remote MCP support, or judge-session MCP injection.

Step 4 in the current repository is intentionally **strategy-only**: it converts `Overview`、`Dependencies & Boundaries`、and `Knowledge & Source of Truth` into `高風險區域` and W# What-if scenarios for later validation. It does **not** perform Step 5 validation, generate findings, or introduce app-side parsing of the W# scenarios.

Step 5 in the current repository is intentionally **first-pass only**: it validates Step 4's W# scenarios, writes first-pass findings into structured in-memory state, and hands them off to Step 6. It now supports repo-local `.reviewconfig.json` `confidenceThresholds` overrides for deterministic filtering, but it still does **not** itself perform final reconciliation, final risk summary generation, or broader app-level settings wiring beyond the currently supported `confidenceThresholds` and `maxConcurrentFiles`.

Step 6 in the current repository is intentionally **findings-finalization only**: it consumes the Step 5 `## Findings` render and structured findings state, performs Cognitive Simulation, and overwrites findings with the final Step 6 result. It does **not** yet generate Step 7 summary output, final risk scoring, or the complete final rendering pipeline.

At the current config boundary, the app reads `repo_root/.reviewconfig.json` once per run and currently supports five fields: `confidenceThresholds` for Step 5 / Step 6 deterministic filtering, `maxConcurrentFiles` for per-file worker-pool concurrency, `mcpServers` for validated repo-local custom MCP merge into review sessions, optional `webFetchAllowedHosts` for repo-local `web_fetch` host allowlist policy (exact hostnames and `*.`-prefixed wildcard subdomain entries), and optional `webFetchDeniedHosts` for repo-local `web_fetch` host denylist policy (same grammar; deny-over-allow when both are configured). Missing config falls back to `must >= 80`, `nice >= 90`, `maxConcurrentFiles = 5`, an empty custom MCP set, no repo-local host allowlist, and no repo-local host denylist; invalid values for any supported field fail the run before Step 0 begins. Built-in Context7 for review sessions is currently sourced from process env (`CONTEXT7_API_KEY` when present), while repo-local custom MCP definitions and `web_fetch` host policy come from `.reviewconfig.json`. `web_fetch` rollout no longer requires repo-local config, but redirect validation, DNS-based host classification, remote MCP support, and judge-session MCP injection are still deferred.

Step 7 in the current repository is intentionally **per-file summary only**: it consumes the completed review note after Step 6, writes `## Summary`, and provides the reader-facing audit trail for that file. Run-level aggregate summary and review index now exist as separate deterministic `summary.md` and `index.md` artifacts, but Step 7 still does **not** add additional structured summary state, aggregate AI synthesis, or the complete final export pipeline.

## Development

Useful commands:

```bash
npm install
npm run build
npm test
npm pack
npm link
```

Installation:

- Formal package install:

```bash
npm pack
npm install -g ./nightowl-0.1.0.tgz
```

- Local development workflow:

```bash
npm install
npm link
```

Implementation notes:

- Source files live under `src/` in TypeScript.
- Published CLI artifacts live under `dist/` in JavaScript and are what the installed `review` command executes.
- The formal CLI install contract is based on a published package or package artifact; source checkouts are for local development and should use `npm link`.
- A valid `review` run now depends on a working GitHub Copilot CLI environment and login state, because Step 0, Step 1, Step 2, Step 3, Step 4, Step 5, Step 6, and Step 7 are all executed before the command completes.
- The current source-install flow regenerates `dist/`, so both local development and installation from this repo currently require Node 25+.
- If the project later ships prebuilt artifacts or adopts a different build toolchain, the minimum runtime version can be revisited separately from the source build requirement.

## Planned Experience

The intended usage model is a command such as:

```bash
review <base_ref> <head_ref> [--repo <path>]
```

Future changes will extend the current Step 0 + Step 1 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7 plus bounded per-file concurrency, skipped-file pipeline, successful-snapshot output health assessment, output-failure taxonomy, shared-output abort coordination, run-level aggregate summary, review index, and completed-run artifact surface foundations into broader external knowledge tooling beyond the current built-in Context7 + validated local custom MCP + exact-host web_fetch host-policy rollout, rollback / retry / recovery for output failures, and the full final review output pipeline.
