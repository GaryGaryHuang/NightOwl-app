# NightOwl

NightOwl is a local code review CLI built with the GitHub Copilot SDK.

The project is designed to review changes between two Git refs in a local repository, then produce structured review notes instead of a free-form chat response. Its goal is to make AI-assisted review more traceable, more repeatable, and easier to use as a starting point for human review.

## Current Status

The current repository implements the Step 0 + Step 1 foundation stage. This stage provides:

- an installable `review` executable
- argument parsing for `review <base_ref> <head_ref> [--repo <path>] [--context <value>]`
- Step 0 (Changeset Overview) execution through the GitHub Copilot SDK before local bootstrap continues
- local Git-backed review run preparation, including repo root discovery and `.reviewignore` filtering
- review output path planning and initialization under `<output_base_dir>/review/<session_id>/`
- bootstrap note artifacts for each planned file before Step 1 runs
- Step 1 (Overview) execution for each planned file with `RunContext.changesetOverview` injected into the prompt
- judge-based completion checks for Step 1, so Overview content is written only after the judge passes
- per-file in-memory review state plus minimal note rendering for bootstrap and Step 1 Overview snapshots
- conservative Step 1 failure handling: if a Step 1 attempt or its judge check fails twice, the run stops, earlier successful snapshots remain, and unfinished files keep their bootstrap notes

The full AI review orchestration is not implemented yet. Step 2–7, skipped-file / retry strategy beyond the current Step 1 foundation, bounded concurrency, MCP / `web_fetch`, and the complete final rendering pipeline are still deferred.

## Current Behavior

After installation, a valid command now requires a working GitHub Copilot CLI login, executes Step 0 (Changeset Overview), runs Step 1 (Overview) for each planned file, and then reports the same stable run summary:

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

For successfully processed files, the note is updated from the bootstrap skeleton into a Step 1 Overview snapshot that begins with:

```md
# path/to/file.ts

- Source file: `path/to/file.ts`

## Overview
...
```

Invalid input still fails fast with a usage error, and successful runs with zero planned files still exit successfully.

At this stage, Step 1 now uses Judge completion checks with retry once semantics. If the review attempt or judge check still fails after retry, the run stops immediately, `skipped.md` remains unchanged, already-successful files keep their Overview snapshots, and unfinished files keep only their bootstrap notes.

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
- A valid `review` run now depends on a working GitHub Copilot CLI environment and login state, because Step 0 and Step 1 are both executed before the command completes.
- The current source-install flow regenerates `dist/`, so both local development and installation from this repo currently require Node 25+.
- If the project later ships prebuilt artifacts or adopts a different build toolchain, the minimum runtime version can be revisited separately from the source build requirement.

## Planned Experience

The intended usage model is a command such as:

```bash
review <base_ref> <head_ref> [--repo <path>]
```

Future changes will extend the current Step 0 + Step 1 + judge foundation into the remaining per-file SOP steps, skipped-file strategy, bounded concurrency, and the full final review output pipeline.
