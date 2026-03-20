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
- Step 3 (Knowledge & Source of Truth) execution for each planned file using a local-first / repo-native evidence contract after Step 2 succeeds
- Step 4 (Strategy & What-if Scenarios) execution for each planned file after Step 3 succeeds, producing scenario-driven validation strategy from the accumulated review state
- Step 5 (Validation & Interrogation) execution for each planned file after Step 4 succeeds, producing first-pass findings through deterministic JSON validation and confidence filtering
- Step 6 (Cognitive Simulation) execution for each planned file after Step 5 succeeds, consuming first-pass findings and overwriting them with final findings through deterministic JSON validation and confidence filtering
- Step 7 (Summary) execution for each planned file after Step 6 succeeds, producing a reader-facing audit trail section from the completed review note
- judge-based completion checks for Step 1, Step 2, Step 3, Step 4, and Step 7, so section content is written only after the judge passes
- deterministic validation plus confidence filtering for Step 5 and Step 6 findings JSON before formal findings state is updated
- per-file in-memory review state plus minimal note rendering for bootstrap, Step 1, Step 2, Step 3, Step 4, Step 5, Step 6, and Step 7 snapshots
- skipped-file pipeline foundation for Step 1–7 exhaustion: if a section-step attempt or its judge check fails twice, or if Step 5 / Step 6 review or deterministic validation fails twice, that file is downgraded to skipped, its last successful formal snapshot is preserved with a deterministic warning block, one record is appended to `skipped.md`, and later planned files continue
- output-failure taxonomy foundation for current local output edges: `initializeRun()`, bootstrap note publish, successful snapshot publish, interrupted snapshot publish, and `publishSkippedFile()` failures remain fatal output-layer errors and are not downgraded to skipped files
- run-level aggregate summary foundation for completed runs: the app now writes deterministic `summary.md` with planned / successful / skipped counts, final findings totals from successful files only, and planned-order successful / skipped file lists
- review index foundation for completed runs: the app now writes deterministic `index.md` as a landing page that links `summary.md`, `skipped.md`, and every planned per-file note in planned order
- CLI run summary fields foundation for completed runs: the success summary now prints `summary.md` path plus planned / successful / skipped counts directly from the app boundary
- minimal interruption-state rendering so skipped files keep bootstrap, Step 1, Step 4, or Step 6 snapshots without leaking provisional failed-step content

The full AI review orchestration is not implemented yet. This repository now includes the Step 7 foundation on top of the Step 3 local-first knowledge foundation, Step 4 strategy foundation, Step 5 first-pass findings foundation, Step 6 findings-finalization foundation, the skipped-file pipeline foundation for Step 1–7 exhaustion, the conservative output-failure taxonomy foundation for current output edges, the deterministic run-level aggregate summary foundation, the deterministic review index foundation, and the completed-run CLI summary fields foundation; external knowledge tooling for Step 3 is still deferred. Bounded concurrency, MCP / `web_fetch`, `KnowledgeSvc`, richer output-failure coordinator behavior, and the complete final rendering / export pipeline are still deferred.

## Current Behavior

After installation, a valid command now requires a working GitHub Copilot CLI login, executes Step 0 (Changeset Overview), runs Step 1 (Overview), Step 2 (Dependencies & Boundaries), Step 3 (Knowledge & Source of Truth), Step 4 (Strategy & What-if Scenarios), Step 5 (Validation & Interrogation), Step 6 (Cognitive Simulation), and Step 7 (Summary) for each planned file, and then reports the same stable run summary:

```bash
review main feature-branch
```

```text
Initialized local review run.
Repo root: /path/to/repo
Output: /path/to/repo/review/feature-branch_03131430
Summary: /path/to/repo/review/feature-branch_03131430/summary.md
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

At the current foundation boundary, output-layer failures are still more conservative than step exhaustion. If `initializeRun()`, bootstrap note publish, successful snapshot publish, interrupted snapshot publish, or `publishSkippedFile()` throws, the run aborts immediately with the underlying output error. These failures are not reclassified as skipped files, and the runtime does not attempt rollback or best-effort recovery.

For completed runs, the app now also writes a deterministic run-level `summary.md` after all per-file notes and skipped artifacts are finalized. That artifact includes run metadata, planned / successful / skipped counts, final findings totals from successful files only, a `## Successful Files` section, and a `## Skipped Files` section. Zero-file runs still produce `summary.md` with explicit `- 無` sections. Fatal runs do not publish `summary.md`, and if writing `summary.md` itself fails, the run aborts with the underlying output error.

For the same completed runs, the app now also writes a deterministic `index.md` after `summary.md` succeeds. That artifact is a landing page rather than a second aggregate report: it links `summary.md`, `skipped.md`, and every planned file note in planned order, including collision-resolved note names under `files/`. Zero-file runs still produce `index.md` with `## File Notes` rendered as `- 無`. Fatal runs do not publish `index.md`, and if writing `index.md` itself fails after `summary.md` is already written, the run still aborts with the underlying output error.

The CLI success summary now aligns with the completed-run accounting used for `summary.md`: it prints `Summary: <summaryPath>`, `Planned files`, `Successful files`, and `Skipped files` directly from the app boundary. It does **not** yet print `index.md` or introduce a richer export surface. All-successful runs, mixed-result runs, all-skipped runs, and zero-file runs all remain successful completed runs as long as no fatal runtime error occurs.

Step 3 in the current repository is intentionally **local-first**: it converges `版本／文件參考`、`採用規則與假設`、`排除範圍` from repo-native / local evidence such as version files, lockfiles, config files, internal docs, project conventions, and necessary local git metadata. It does **not** yet wire MCP, Context7, `web_fetch`, or external official docs into the runtime.

Step 4 in the current repository is intentionally **strategy-only**: it converts `Overview`、`Dependencies & Boundaries`、and `Knowledge & Source of Truth` into `高風險區域` and W# What-if scenarios for later validation. It does **not** perform Step 5 validation, generate findings, or introduce app-side parsing of the W# scenarios.

Step 5 in the current repository is intentionally **first-pass only**: it validates Step 4's W# scenarios, writes first-pass findings into structured in-memory state, and hands them off to Step 6. It does **not** itself perform final reconciliation, final risk summary generation, or config-driven confidence-threshold overrides.

Step 6 in the current repository is intentionally **findings-finalization only**: it consumes the Step 5 `## Findings` render and structured findings state, performs Cognitive Simulation, and overwrites findings with the final Step 6 result. It does **not** yet generate Step 7 summary output, final risk scoring, or the complete final rendering pipeline.

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

Future changes will extend the current Step 0 + Step 1 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7 plus skipped-file pipeline, output-failure taxonomy, run-level aggregate summary, review index, and CLI run summary fields foundations into bounded concurrency, external knowledge tooling for Step 3, richer output-failure coordinator behavior, and the full final review output pipeline.
