<!-- markdownlint-disable MD024 -->
<!-- Keep a Changelog repeats Added/Fixed/Changed headings under each release. -->

# Change Log

All notable changes to the **LaTeX Citation Stats** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Search bar** at the top of the Citations view with the same three toggles as VS Code's
  Search panel: **Match Case** (`Aa`), **Match Whole Word** (`ab`), and **Use Regular
  Expression** (`.*`). Search matches each source's key, title, author, and year (and
  undefined keys), runs entirely in-memory, and invalid regular expressions are flagged
  inline instead of throwing.
- **Filter menu** — show *all*, *used only*, *unused only*, or *undefined only*.
- **Sort menu** — order sources by citation count, author, title, year, or key, ascending
  or descending. The chosen filter, sort, and search toggles **persist across restarts**.
- The `.bib` parser now extracts **author** and **year** fields, powering author/year
  search and sort.

### Changed

- The Citations view is now rendered as a **webview** instead of a native tree, so the
  search bar and filter/sort controls can live inside the view. Existing behaviour is
  preserved: the Overview node, live counts, unused/undefined markers, click-to-navigate,
  and the header summary + activity-bar badge all carry over. Source and undefined-key
  actions (**Go to Bib Definition**, **Copy Citation Key**) are now inline hover buttons on
  each row rather than a native right-click menu.
- Development tooling: switched the linter from **ESLint** to **oxlint**, and updated
  **TypeScript** to `7.0.2`.

### Removed

- The `latex-citation-stats.sortOrder` setting. Sorting is now controlled from the view's
  toolbar (with more orders than before) and remembered across restarts.

## [1.1.0] - 2026-07-17

### Added

- **Multicite support** — `\cites`, `\parencites`, `\textcites`, `\autocites` and friends
  take a repeating sequence of groups, and every key is now collected:
  `\cites[S.~12-22]{key1}[S.~1]{key2}` and `\cites[S.~12-22]{key1}{key2}` both yield two
  citations, each with its own exact line and column.
- **Go to Bib Definition** — clicking an **unused** source opens its declaration in the
  `.bib` file with the key selected.
- **Context menu** on sources and occurrences offering **Go to Usage**, **Go to Bib
  Definition**, and **Copy Citation Key**. Occurrences of undefined keys omit the
  definition action, since there is nothing to navigate to.
- **Overview node** at the top of the tree showing total sources, used vs. unused, and
  total citation occurrences across all `.tex` files.
- **View header summary** (`12/47 used · 83 citations`) beside the view title, and an
  **activity-bar badge** counting undefined citation keys.
- Settings **`latex-citation-stats.showOverview`** (default `true`) and
  **`latex-citation-stats.sortOrder`** (`usage` or `alphabetical`).

### Fixed

- Citation keys in `\cites`-style multicite commands were silently dropped: only the first
  key group was read, so `\cites[S.~12-22]{key1}[S.~1]{key2}` counted `key1` but never
  `key2`. Commas inside optional arguments (`[S.~4,6,19]`) are also never mistaken for key
  separators.
- `\citestyle{...}` and `\citereset` no longer count their argument as a citation, and the
  `\nocite{*}` wildcard is no longer treated as a citation key.
- Resolving an entry's title is now a map lookup instead of a linear scan, removing
  quadratic work when rendering large bibliographies.

### Changed

- Repetition of key groups applies only to known multicite commands, so `\cite{a}{b}`
  correctly ignores `{b}` rather than treating it as a second key.
- The internal `latex-citation-stats.openCitation` command was replaced by
  `latex-citation-stats.goToUsage`, alongside the new `goToBibDefinition` and
  `copyCitationKey` commands.

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
