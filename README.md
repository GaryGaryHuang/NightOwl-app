# NightOwl

NightOwl is a local code review CLI built with the GitHub Copilot SDK.

The project is designed to review changes between two Git refs in a local repository, then produce structured review notes instead of a free-form chat response. Its goal is to make AI-assisted review more traceable, more repeatable, and easier to use as a starting point for human review.

## Foundation Status

The current repository implements the CLI foundation only. This stage provides:

- an installable `review` executable
- argument parsing for `review <base_ref> <head_ref> [--repo <path>] [--context <value>]`
- a minimal application boundary that returns a deterministic placeholder success response
- review output path planning logic for future review runs

The full review orchestration, Git providers, Copilot SDK session flow, and structured review generation are not implemented yet.

## Current Behavior

After installation, a valid command currently returns a placeholder message:

```bash
review main feature-branch
```

```text
NightOwl foundation: review workflow is not implemented yet.
```

Invalid input still fails fast with a usage error.

## Development

Useful commands:

```bash
npm run build
npm test
npm install -g .
```

Implementation notes:

- Source files live under `src/` in TypeScript.
- Published CLI artifacts live under `dist/` in JavaScript and are what the installed `review` command executes.
- The current source-install flow (`npm install -g .`) runs `prepare` and regenerates `dist/`, so both local development and installation from this repo currently require Node 25+.
- If the project later ships prebuilt artifacts or adopts a different build toolchain, the minimum runtime version can be revisited separately from the source build requirement.

## Planned Experience

The intended usage model is a command such as:

```bash
review <base_ref> <head_ref> [--repo <path>]
```

Future changes will replace the placeholder app boundary with the real review workflow, Git integration, Copilot SDK orchestration, and structured review output.
