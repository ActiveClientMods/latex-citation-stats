// Pure view-model layer for the Citations webview.
//
// Everything the webview shows — which sources are visible, in what order, and
// which occurrences hang off them — is computed here from the CitationIndex.
// This module is intentionally free of any `vscode` import so the search, filter
// and sort behaviour can be unit-tested without the editor runtime; the provider
// is left as a thin HTML + messaging shell around `buildViewModel`.

import type { BibEntry, Citation, CitationStats } from './types.js';
import type { CitationIndex } from './citationIndex.js';
import { DEFAULT_FILTER, DEFAULT_SORT, type FilterMode, type SortKey } from './viewOptions.js';

/** The complete, serialisable UI state driven from the webview. */
export interface ViewState {
	/** Free-text search. Empty string means "no query". */
	query: string;
	/** Case-sensitive matching. */
	matchCase: boolean;
	/** Match whole words only (word-boundary anchored). */
	matchWholeWord: boolean;
	/** Interpret `query` as a JavaScript regular expression. */
	useRegex: boolean;
	filter: FilterMode;
	sort: SortKey;
}

/** The default state used before anything is persisted. */
export const DEFAULT_STATE: ViewState = {
	query: '',
	matchCase: false,
	matchWholeWord: false,
	useRegex: false,
	filter: DEFAULT_FILTER,
	sort: DEFAULT_SORT,
};

/** A declared `.bib` source, enriched for display and filtered/sorted. */
export interface EntryRow {
	key: string;
	title?: string;
	author?: string;
	year?: number;
	count: number;
	used: boolean;
	occurrences: Citation[];
}

/** A cited-but-undeclared key. */
export interface UndefinedRow {
	key: string;
	count: number;
	occurrences: Citation[];
}

/** Everything the webview needs to render one repaint. */
export interface ViewModel {
	hasBibliography: boolean;
	stats: CitationStats;
	entries: EntryRow[];
	undefinedKeys: UndefinedRow[];
	/** Entries visible after search + filter. */
	visibleSources: number;
	/** Declared entries in total, before search + filter. */
	totalSources: number;
	/** True when `useRegex` is on but `query` is not a valid regular expression. */
	regexError: boolean;
	/** True when a search query or a non-`all` filter is narrowing the list. */
	filtering: boolean;
}

/**
 * A query compiled from the search box and its toggles.
 *
 * `active` is false for an empty query (everything matches); `error` is true
 * when Regex mode is on but the pattern is invalid, in which case `matches`
 * rejects everything rather than throwing.
 */
interface CompiledQuery {
	readonly active: boolean;
	readonly error: boolean;
	matches(text: string): boolean;
}

const MATCH_ALL: CompiledQuery = { active: false, error: false, matches: () => true };
const MATCH_NONE: CompiledQuery = { active: true, error: true, matches: () => false };

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile the query + toggles into a predicate over a single text field.
 * Whole-word and regex modes use a RegExp; plain substring search uses
 * `String.includes` so it stays fast and never throws.
 */
function compileQuery(state: ViewState): CompiledQuery {
	const { query } = state;
	if (query.length === 0) {
		return MATCH_ALL;
	}

	if (!state.useRegex && !state.matchWholeWord) {
		if (state.matchCase) {
			return { active: true, error: false, matches: (text) => text.includes(query) };
		}
		const needle = query.toLowerCase();
		return { active: true, error: false, matches: (text) => text.toLowerCase().includes(needle) };
	}

	const body = state.useRegex ? query : escapeRegExp(query);
	const pattern = state.matchWholeWord ? `\\b(?:${body})\\b` : body;
	try {
		const re = new RegExp(pattern, state.matchCase ? 'u' : 'iu');
		return { active: true, error: false, matches: (text) => re.test(text) };
	} catch {
		return MATCH_NONE;
	}
}

/** True if the query matches any of a declared entry's searchable text fields. */
function entryMatches(entry: BibEntry, query: CompiledQuery): boolean {
	return (
		query.matches(entry.key) ||
		(entry.title !== undefined && query.matches(entry.title)) ||
		(entry.author !== undefined && query.matches(entry.author)) ||
		(entry.year !== undefined && query.matches(String(entry.year)))
	);
}

/**
 * Derive a sort key for an author string: the family name of the first author,
 * lower-cased. BibTeX authors are `Last, First and Last2, First2` or
 * `First Last and ...`; we take everything before the first ` and `, then the
 * part before a comma (family-first form) or the last whitespace-delimited token.
 */
export function authorSortKey(author: string | undefined): string {
	if (!author) {
		return '';
	}
	const first = author.split(/\s+and\s+/i)[0].trim();
	const comma = first.indexOf(',');
	const family = comma === -1 ? first.split(/\s+/).pop() ?? first : first.slice(0, comma);
	return family.trim().toLowerCase();
}

/**
 * Comparator for two entries under a given sort. Entries missing the sort field
 * (no author / no year) are pushed to the end; ties fall back to the key so the
 * order is always stable.
 */
function compareEntries(sort: SortKey): (a: EntryRow, b: EntryRow) => number {
	const byKeyAsc = (a: EntryRow, b: EntryRow): number => a.key.localeCompare(b.key);
	const missingLast = (a: string, b: string, cmp: number): number => {
		if (a === b) {
			return 0;
		}
		if (a === '') {
			return 1;
		}
		if (b === '') {
			return -1;
		}
		return cmp;
	};

	switch (sort) {
		case 'count-asc':
			return (a, b) => a.count - b.count || byKeyAsc(a, b);
		case 'author-asc':
		case 'author-desc': {
			const dir = sort === 'author-desc' ? -1 : 1;
			return (a, b) => {
				const ka = authorSortKey(a.author);
				const kb = authorSortKey(b.author);
				return missingLast(ka, kb, dir * ka.localeCompare(kb)) || byKeyAsc(a, b);
			};
		}
		case 'title-asc':
		case 'title-desc': {
			const dir = sort === 'title-desc' ? -1 : 1;
			return (a, b) => {
				const ta = (a.title ?? '').toLowerCase();
				const tb = (b.title ?? '').toLowerCase();
				return missingLast(ta, tb, dir * ta.localeCompare(tb)) || byKeyAsc(a, b);
			};
		}
		case 'year-desc':
		case 'year-asc': {
			const dir = sort === 'year-asc' ? 1 : -1;
			return (a, b) => {
				const ya = a.year;
				const yb = b.year;
				if (ya === yb) {
					return byKeyAsc(a, b);
				}
				if (ya === undefined) {
					return 1;
				}
				if (yb === undefined) {
					return -1;
				}
				return dir * (ya - yb) || byKeyAsc(a, b);
			};
		}
		case 'key-asc':
			return byKeyAsc;
		case 'key-desc':
			return (a, b) => b.key.localeCompare(a.key);
		case 'count-desc':
		default:
			return (a, b) => b.count - a.count || byKeyAsc(a, b);
	}
}

/**
 * Compute the full view model for one repaint: apply the search matcher and the
 * filter to the declared entries and the undefined keys, then sort the entries.
 */
export function buildViewModel(index: CitationIndex, state: ViewState): ViewModel {
	const query = compileQuery(state);
	const stats = index.getStats();
	const showUndefined = state.filter === 'all' || state.filter === 'undefined';
	const showEntries = state.filter !== 'undefined';

	const entries: EntryRow[] = [];
	if (showEntries) {
		for (const { entry, count } of index.getEntriesWithCounts()) {
			const used = count > 0;
			if (state.filter === 'used' && !used) {
				continue;
			}
			if (state.filter === 'unused' && used) {
				continue;
			}
			if (!entryMatches(entry, query)) {
				continue;
			}
			entries.push({
				key: entry.key,
				title: entry.title,
				author: entry.author,
				year: entry.year,
				count,
				used,
				occurrences: used ? index.getCitations(entry.key) : [],
			});
		}
		entries.sort(compareEntries(state.sort));
	}

	const undefinedKeys: UndefinedRow[] = [];
	if (showUndefined) {
		for (const key of index.getUndefinedKeys()) {
			if (!query.matches(key)) {
				continue;
			}
			undefinedKeys.push({ key, count: index.getCount(key), occurrences: index.getCitations(key) });
		}
	}

	return {
		hasBibliography: index.hasBibliography(),
		stats,
		entries,
		undefinedKeys,
		visibleSources: entries.length,
		totalSources: stats.totalSources,
		regexError: query.error,
		filtering: state.query.length > 0 || state.filter !== 'all',
	};
}
