# NightOwl

NightOwl is a local code review CLI built with the GitHub Copilot SDK.

The project is designed to review changes between two Git refs in a local repository, then produce structured review notes instead of a free-form chat response. Its goal is to make AI-assisted review more traceable, more repeatable, and easier to use as a starting point for human review.

## Current Status

The current repository implements the local review run bootstrap stage. This stage provides:

- an installable `review` executable
- argument parsing for `review <base_ref> <head_ref> [--repo <path>] [--context <value>]`
- Step 0 (Changeset Overview) execution through the GitHub Copilot SDK before local bootstrap continues
- local Git-backed review run preparation, including repo root discovery and `.reviewignore` filtering
- review output path planning and initialization under `<output_base_dir>/review/<session_id>/`
- bootstrap note artifacts for each planned file before any AI review steps run

The full AI review orchestration, Step 0–7 pipeline, Copilot SDK session flow, and structured review generation are not implemented yet.

## Current Behavior

After installation, a valid command now requires a working GitHub Copilot CLI login, executes Step 0 (Changeset Overview), and then initializes a local review run with a stable summary:

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
- one bootstrap Markdown note per planned file

Invalid input still fails fast with a usage error, and successful runs with zero planned files still exit successfully.

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
- A valid `review` run now depends on a working GitHub Copilot CLI environment and login state, because Step 0 is executed before local bootstrap output is created.
- The current source-install flow regenerates `dist/`, so both local development and installation from this repo currently require Node 25+.
- If the project later ships prebuilt artifacts or adopts a different build toolchain, the minimum runtime version can be revisited separately from the source build requirement.

## Planned Experience

The intended usage model is a command such as:

```bash
review <base_ref> <head_ref> [--repo <path>]
```

Future changes will replace the bootstrap note stage with the real AI review workflow, Step 0 run context generation, Copilot SDK orchestration, and structured review output.
