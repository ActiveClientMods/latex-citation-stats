# Change Log

All notable changes to the **LaTeX Citation Stats** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.0.0] - 2026-07-16

Initial release.

### Added

- **LaTeX Citations sidebar view** in the activity bar listing every entry from the
  workspace's `.bib` file(s).
- **Live citation counts** per source, aggregated across all `.tex` files, ordered
  most-cited first.
- **Unused-reference detection** — sources with zero citations are flagged as `unused`
  with a distinct warning icon.
- **Expandable occurrences** — each source expands to show every citation instance as
  `file:line`, with a preview of the source line.
- **Jump-to-citation** — clicking an occurrence opens the `.tex` file and selects the
  citation key at its exact line and column.
- **Undefined-citation tracking** — keys cited in `.tex` but absent from every `.bib` file
  are grouped under a dedicated node.
- **BibTeX parsing** with brace-depth-aware extraction of entry types, keys, and titles
  (including nested braces); `@comment`, `@string`, and `@preamble` are skipped.
- **LaTeX citation parsing** for the full `\...cite...` family (`\cite`, `\citep`,
  `\citet`, `\textcite`, `\parencite`, `\autocite`, `\footcite`, `\nocite`, capitalized
  biblatex variants, …), including multi-key groups split with per-key columns, skipped
  optional arguments, and correct handling of LaTeX comments and escaped `\%`.
- **Real-time updates** via debounced text-change handling and file-system watchers for
  create/change/delete of `.bib` and `.tex` files.
- **Incremental caching** that re-parses only the changed document and merges the delta
  into the global index, avoiding full-workspace rescans on every edit.
- **`latex-citation-stats.debounceDelay`** setting (default `250` ms).
- **`Refresh Citations`** command with a title-bar button to force a full re-scan.
- Fully **offline** operation: no network requests, no telemetry, and zero runtime
  dependencies.
