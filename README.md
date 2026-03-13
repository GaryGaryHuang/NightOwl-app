# NightOwl

NightOwl is a local code review CLI built with the GitHub Copilot SDK.

The project is designed to review changes between two Git refs in a local repository, then produce structured review notes instead of a free-form chat response. Its goal is to make AI-assisted review more traceable, more repeatable, and easier to use as a starting point for human review.

## What It Does

- Reviews a local changeset with `base_ref` and `head_ref`
- Follows a defined review workflow instead of a single prompt
- Produces structured review output with clear sections and findings
- Emphasizes evidence, traceability, and conservative conclusions

## Project Direction

NightOwl is being developed as a local-first tool for engineers who want a more disciplined code review workflow. The current design centers on:

- a CLI entry point for running reviews locally
- Git-based diff analysis
- GitHub Copilot SDK as the review engine
- structured Markdown review artifacts as output

## Status

This project is in active early development. The public repository is currently focused on building the application foundation and core review workflow.

## Planned Experience

The intended usage model is a command such as:

```bash
review <base_ref> <head_ref> [--repo <path>]
```

The exact interface and implementation details may continue to evolve during development.
