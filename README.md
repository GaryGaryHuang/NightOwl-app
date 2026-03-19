# NightOwl

NightOwl is a local code review CLI built with the GitHub Copilot SDK.

The project is designed to review changes between two Git refs in a local repository, then produce structured review notes instead of a free-form chat response. Its goal is to make AI-assisted review more traceable, more repeatable, and easier to use as a starting point for human review.

## Current Status

The current repository implements the Step 0 + Step 1 + Step 2 + Step 3 + Step 4 + Step 5 foundation stage. This stage provides:

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
- judge-based completion checks for Step 1, Step 2, Step 3, and Step 4, so section content is written only after the judge passes
- deterministic validation plus confidence filtering for Step 5 findings JSON before formal findings state is updated
- per-file in-memory review state plus minimal note rendering for bootstrap, Step 1, Step 2, Step 3, Step 4, and Step 5 snapshots
- conservative failure handling for Step 1–5: if a section-step attempt or its judge check fails twice, or if Step 5 review / deterministic validation fails twice, the run stops, earlier successful snapshots remain, and unfinished files keep their last successfully published note state

The full AI review orchestration is not implemented yet. This repository now includes the Step 5 foundation on top of the Step 3 local-first knowledge foundation and Step 4 strategy foundation; external knowledge tooling for Step 3 is still deferred. Step 6–7, skipped-file / retry strategy beyond the current Step 1 + Step 2 + Step 3 + Step 4 + Step 5 foundation, bounded concurrency, MCP / `web_fetch`, `KnowledgeSvc`, and the complete final rendering pipeline are still deferred.

## Current Behavior

After installation, a valid command now requires a working GitHub Copilot CLI login, executes Step 0 (Changeset Overview), runs Step 1 (Overview), Step 2 (Dependencies & Boundaries), Step 3 (Knowledge & Source of Truth), Step 4 (Strategy & What-if Scenarios), and Step 5 (Validation & Interrogation) for each planned file, and then reports the same stable run summary:

```bash
review main feature-branch
```

```text
Initialized local review run.
Repo root: /path/to/repo
Output: /path/to/repo/review/feature-branch_03131430
Planned files: 3
```

The command also creates:

- `<output_base_dir>/review/<session_id>/`
- `<output_base_dir>/review/<session_id>/files/`
- `<output_base_dir>/review/<session_id>/skipped.md`
- one Markdown note per planned file

For successfully processed files, the note is updated from the bootstrap skeleton into a Step 1 + Step 2 + Step 3 + Step 4 + Step 5 snapshot that begins with:

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
```

Invalid input still fails fast with a usage error, and successful runs with zero planned files still exit successfully.

At this stage, Step 1, Step 2, Step 3, and Step 4 all use Judge completion checks with retry once semantics, while Step 5 uses deterministic JSON validation with the same retry-once exhaustion model. If a step still fails after retry, the run stops immediately, `skipped.md` remains unchanged, already-successful files keep their last successful snapshots, and unfinished files keep only the last state that was successfully published.

Step 3 in the current repository is intentionally **local-first**: it converges `版本／文件參考`、`採用規則與假設`、`排除範圍` from repo-native / local evidence such as version files, lockfiles, config files, internal docs, project conventions, and necessary local git metadata. It does **not** yet wire MCP, Context7, `web_fetch`, or external official docs into the runtime.

Step 4 in the current repository is intentionally **strategy-only**: it converts `Overview`、`Dependencies & Boundaries`、and `Knowledge & Source of Truth` into `高風險區域` and W# What-if scenarios for later validation. It does **not** perform Step 5 validation, generate findings, or introduce app-side parsing of the W# scenarios.

Step 5 in the current repository is intentionally **first-pass only**: it validates Step 4's W# scenarios, writes first-pass findings into structured in-memory state, and renders a minimal `## Findings` section. It does **not** yet perform Step 6 reconciliation / overwrite, final risk summary generation, or config-driven confidence-threshold overrides.

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
- A valid `review` run now depends on a working GitHub Copilot CLI environment and login state, because Step 0, Step 1, Step 2, Step 3, Step 4, and Step 5 are all executed before the command completes.
- The current source-install flow regenerates `dist/`, so both local development and installation from this repo currently require Node 25+.
- If the project later ships prebuilt artifacts or adopts a different build toolchain, the minimum runtime version can be revisited separately from the source build requirement.

## Planned Experience

The intended usage model is a command such as:

```bash
review <base_ref> <head_ref> [--repo <path>]
```

Future changes will extend the current Step 0 + Step 1 + Step 2 + Step 3 + Step 4 + Step 5 foundation into the remaining per-file SOP steps, external knowledge tooling for Step 3, skipped-file strategy, bounded concurrency, and the full final review output pipeline.
