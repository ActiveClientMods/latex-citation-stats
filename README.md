<!-- markdownlint-disable MD033 -->

# LaTeX Citation Stats

A real-time citation manager and tracker for LaTeX, built for VS Code. It reads your
workspace's `.bib` bibliographies and `.tex` sources and shows, in a dedicated sidebar
view, **which references you actually cite, how often, and exactly where** — updating
live as you type.

It is designed for writing long, sensitive documents (theses, papers, reports): it runs
**completely offline**, ships **zero runtime dependencies**, and never makes a network
request or emits telemetry.

## Features

- **Sources tree in the activity bar.** A dedicated **LaTeX Citations** view lists every
  entry found in your workspace `.bib` file(s).
- **Live citation counts.** Each source shows how many times it is cited across all `.tex`
  files. Entries are ordered most-cited first.
- **Unused references stand out.** Sources with zero citations are marked `unused` with a
  distinct warning icon, so dead bibliography entries are easy to spot and prune.
- **Expand to every occurrence.** Expanding a source reveals every individual citation
  instance as `file:line`, each with a preview of the source line.
- **Jump to the exact spot.** Clicking an occurrence opens the `.tex` file and places the
  cursor precisely on the citation key — correct line _and_ column, with the key selected.
- **Undefined citations.** Keys you cite but that don't exist in any `.bib` file are
  collected under a separate **Undefined citations** node, so broken references surface
  immediately.
- **Real-time updates.** The tree refreshes as you type in a `.tex` or `.bib` file, and
  reacts to files being created, changed, or deleted on disk.

## How it works

### Parsing

- **`.bib` files** — Entry types, keys, and titles are extracted with a brace-depth-aware
  scan, so nested braces in titles (e.g. `{The {LaTeX} Companion}`) are handled correctly.
  `@comment`, `@string`, and `@preamble` blocks are ignored.
- **`.tex` files** — The whole `\...cite...` family is recognised in a single pass:
  `\cite`, `\citep`, `\citet`, `\textcite`, `\parencite`, `\autocite`, `\footcite`,
  `\nocite`, `\citeauthor`, capitalized biblatex variants (`\Textcite`, …), and so on.
  - Multi-key groups such as `\cite{a, b, c}` are split into one tracked occurrence per
    key, each with its own exact column.
  - Optional arguments (`\cite[p.~5]{key}`, `\autocite[see][p.~5]{key}`) are skipped.
  - LaTeX comments are ignored — a `% \cite{...}` is never counted, and an escaped `\%`
    does not start a comment.

### Performance & architecture

- **Incremental cache.** State is stored per source key and per file. When you edit a
  single document, only that document is re-parsed and its slice is merged into the global
  index — the extension never rescans the whole workspace on a keystroke.
- **Debounced updates.** Text-change events are debounced per file (250 ms by default), so
  fast typing doesn't cause UI lag or excessive CPU use.
- **Full scan only when needed.** The workspace is read in full exactly once on activation;
  everything after that is single-file deltas driven by editor events and file watchers.

## Getting started

1. Open a folder (or multi-root workspace) that contains at least one `.bib` and one
   `.tex` file.
2. Click the **LaTeX Citations** icon in the activity bar.
3. Browse your sources, expand them to see every occurrence, and click an occurrence to
   jump straight to it.

Use the **Refresh** button in the view's title bar to force a full re-scan at any time.

## Extension settings

| Setting                              | Type   | Default | Description                                                                                                                                            |
| ------------------------------------ | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `latex-citation-stats.debounceDelay` | number | `250`   | Delay in milliseconds before re-parsing a document after you stop typing. Higher values reduce CPU usage while typing; lower values feel more instant. |

## Commands

| Command           | ID                                  | Notes                                                                                           |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Refresh Citations | `latex-citation-stats.refresh`      | Available from the view's title bar and the Command Palette. Triggers a full workspace re-scan. |
| Open Citation     | `latex-citation-stats.openCitation` | Used internally by the tree to navigate to an occurrence.                                       |

## Privacy & security

This extension is built for confidential, unpublished documents:

- **Offline only** — it uses solely the native VS Code API and Node.js. No external APIs.
- **No network requests** of any kind.
- **No telemetry.**
- **Zero runtime dependencies** — the shipped bundle contains only the extension's own
  code, keeping the supply-chain surface effectively empty.

## Requirements

- VS Code `^1.125.0`.
- No other dependencies or configuration.

## Known limitations

- Parsing is intentionally regex/brace-scan based rather than a full LaTeX/BibTeX grammar.
  Custom citation macros are detected only if their command name contains `cite`.
- BibTeX `@string` abbreviations are not expanded when deriving titles.

## Development

This project uses [Bun](https://bun.com/) for all package management and scripts.

```bash
bun install          # install dev dependencies
bun run compile      # type-check, lint, and bundle with esbuild
bun run watch        # incremental rebuild while developing
bun run test         # compile, lint, bundle, and run the full test suite
```

Press <kbd>F5</kbd> in VS Code to launch the Extension Development Host with the extension
loaded.

### Testing

The suite runs inside a real VS Code instance via `@vscode/test-cli` and covers:

- **Unit tests** for the parsers, the offset→position math, the debouncer, and the
  incremental citation index (happy paths, error/malformed input, and edge cases).
- **Integration tests** for the tree view and the navigation command.
- **An end-to-end test** that drives the full manager against a fixtures workspace,
  verifying the initial scan and that live (unsaved) edits flow through debounce into the
  index as a delta.

### Continuous integration

A GitHub Actions workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on
every push and pull request. It installs with Bun, audits production dependencies, type-
checks, lints, and runs the full test suite headlessly (via `xvfb`).

## Release notes

See [CHANGELOG.md](CHANGELOG.md) for the full history.
