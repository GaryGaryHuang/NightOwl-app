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
- Minimal session foundation for Copilot SDK integration
- Minimal Step 0 guardrails for `read`, `bash`, and `write`

The app does **not** yet implement:

- Step 1–7 per-file review flow
- `StepRunner`
- Judge / completion-check services
- MCP / Context7 integration
- `web_fetch` / URL permission-policy integration
- `KnowledgeSvc`
- bounded concurrency
- final review note rendering pipeline

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
