// The canonical catalogue of filter and sort options for the Citations view.
//
// Defining them once here — ids, labels and grouping — lets every layer share a
// single source of truth: the union types below are *derived* from these arrays,
// the view provider reuses them to validate persisted state, and it forwards the
// same list to the webview so the menus never drift out of sync with the code
// that acts on them.

/** A selectable option in the filter or sort menu. */
export interface ViewOption<Id extends string> {
	readonly id: Id;
	readonly label: string;
	/** Menu group; the webview draws a separator between adjacent groups. */
	readonly group: string;
}

export const FILTER_OPTIONS = [
	{ id: 'all', label: 'All citations', group: 'filter' },
	{ id: 'used', label: 'Used only', group: 'filter' },
	{ id: 'unused', label: 'Unused only', group: 'filter' },
	{ id: 'undefined', label: 'Undefined only', group: 'filter' },
] as const satisfies readonly ViewOption<string>[];

export const SORT_OPTIONS = [
	{ id: 'count-desc', label: 'Most cited', group: 'count' },
	{ id: 'count-asc', label: 'Least cited', group: 'count' },
	{ id: 'author-asc', label: 'Author (A–Z)', group: 'author' },
	{ id: 'author-desc', label: 'Author (Z–A)', group: 'author' },
	{ id: 'title-asc', label: 'Title (A–Z)', group: 'title' },
	{ id: 'title-desc', label: 'Title (Z–A)', group: 'title' },
	{ id: 'year-desc', label: 'Year (newest first)', group: 'year' },
	{ id: 'year-asc', label: 'Year (oldest first)', group: 'year' },
	{ id: 'key-asc', label: 'Key (A–Z)', group: 'key' },
	{ id: 'key-desc', label: 'Key (Z–A)', group: 'key' },
] as const satisfies readonly ViewOption<string>[];

/** Which subset of sources is shown. */
export type FilterMode = (typeof FILTER_OPTIONS)[number]['id'];
/** How the source list is ordered. */
export type SortKey = (typeof SORT_OPTIONS)[number]['id'];

export const DEFAULT_FILTER: FilterMode = 'all';
export const DEFAULT_SORT: SortKey = 'count-desc';

const FILTER_IDS: ReadonlySet<string> = new Set(FILTER_OPTIONS.map((o) => o.id));
const SORT_IDS: ReadonlySet<string> = new Set(SORT_OPTIONS.map((o) => o.id));

export function isFilterMode(value: unknown): value is FilterMode {
	return typeof value === 'string' && FILTER_IDS.has(value);
}

export function isSortKey(value: unknown): value is SortKey {
	return typeof value === 'string' && SORT_IDS.has(value);
}
