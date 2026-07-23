import type { BibEntry, Citation, CitationStats, EntryWithCount, SortOrder } from './types.js';

// In-memory citation cache.
//
// This is the heart of the "smart caching" requirement. State is stored so that
// a change to a single file touches only that file's slice — never a full
// workspace rescan.
//
// Layout:
//   entriesByBibFile : bibPath  -> entries declared there      (bib source of truth)
//   entriesByKey     : key      -> entry                        (merged view, rebuilt on bib change)
//   citationsByKey   : key      -> (texPath -> citations)       (nested so one file updates in place)
//   keysByTexFile    : texPath  -> set of keys it contributes   (lets us diff old vs new on update)
//
// Nesting citations by key *and then* by file is what makes the tex delta O(keys
// in the changed file): we replace exactly one inner entry, never walking other
// files' data.

export class CitationIndex {
	private readonly entriesByBibFile = new Map<string, BibEntry[]>();
	private entriesByKey = new Map<string, BibEntry>();

	private readonly citationsByKey = new Map<string, Map<string, Citation[]>>();
	private readonly keysByTexFile = new Map<string, Set<string>>();

	// ---- Bibliography side -------------------------------------------------

	/** Replace all entries contributed by one `.bib` file and rebuild the merged view. */
	updateBibFile(filePath: string, entries: BibEntry[]): void {
		this.entriesByBibFile.set(filePath, entries);
		this.rebuildEntriesByKey();
	}

	/** Drop a `.bib` file (deleted or excluded) and rebuild the merged view. */
	removeBibFile(filePath: string): void {
		if (this.entriesByBibFile.delete(filePath)) {
			this.rebuildEntriesByKey();
		}
	}

	// Bib files are few and small, so a full merge on change is cheap and avoids
	// bookkeeping for keys duplicated across multiple `.bib` files.
	private rebuildEntriesByKey(): void {
		this.entriesByKey = new Map();
		for (const entries of this.entriesByBibFile.values()) {
			for (const entry of entries) {
				// First declaration wins; keeps behavior deterministic on dupes.
				if (!this.entriesByKey.has(entry.key)) {
					this.entriesByKey.set(entry.key, entry);
				}
			}
		}
	}

	// ---- Citation (tex) side ----------------------------------------------

	/**
	 * Merge one `.tex` file's citations into the global state as a delta:
	 * only keys previously or newly present in *this* file are touched.
	 */
	updateTexFile(filePath: string, citations: Citation[]): void {
		// Group the freshly parsed citations by key.
		const grouped = new Map<string, Citation[]>();
		for (const citation of citations) {
			const list = grouped.get(citation.key);
			if (list) {
				list.push(citation);
			} else {
				grouped.set(citation.key, [citation]);
			}
		}

		// Remove this file from keys it no longer cites.
		const oldKeys = this.keysByTexFile.get(filePath);
		if (oldKeys) {
			for (const key of oldKeys) {
				if (!grouped.has(key)) {
					this.detachFileFromKey(key, filePath);
				}
			}
		}

		// Insert/replace this file's slice for each currently cited key.
		for (const [key, list] of grouped) {
			let byFile = this.citationsByKey.get(key);
			if (!byFile) {
				byFile = new Map();
				this.citationsByKey.set(key, byFile);
			}
			byFile.set(filePath, list);
		}

		this.keysByTexFile.set(filePath, new Set(grouped.keys()));
	}

	/** Remove a `.tex` file entirely (deleted or excluded). */
	removeTexFile(filePath: string): void {
		const keys = this.keysByTexFile.get(filePath);
		if (!keys) {
			return;
		}
		for (const key of keys) {
			this.detachFileFromKey(key, filePath);
		}
		this.keysByTexFile.delete(filePath);
	}

	private detachFileFromKey(key: string, filePath: string): void {
		const byFile = this.citationsByKey.get(key);
		if (!byFile) {
			return;
		}
		byFile.delete(filePath);
		if (byFile.size === 0) {
			this.citationsByKey.delete(key);
		}
	}

	// ---- Read model (consumed by the view) --------------------------------

	/**
	 * All declared entries with live counts.
	 *
	 * `usage` (default) sorts most-used first with unused last; `alphabetical`
	 * sorts by key.
	 */
	getEntriesWithCounts(sort: SortOrder = 'usage'): EntryWithCount[] {
		const result: EntryWithCount[] = [];
		for (const entry of this.entriesByKey.values()) {
			result.push({ entry, count: this.getCount(entry.key) });
		}
		result.sort(
			sort === 'alphabetical'
				? (a, b) => a.entry.key.localeCompare(b.entry.key)
				: (a, b) => b.count - a.count || a.entry.key.localeCompare(b.entry.key),
		);
		return result;
	}

	/** The declared entry for a key, if any. */
	getEntry(key: string): BibEntry | undefined {
		return this.entriesByKey.get(key);
	}

	/** Aggregate figures for the Overview node and the view header. */
	getStats(): CitationStats {
		let usedSources = 0;
		let totalCitations = 0;
		for (const key of this.entriesByKey.keys()) {
			const count = this.getCount(key);
			if (count > 0) {
				usedSources++;
			}
		}
		// Count every occurrence, including those for undeclared keys.
		for (const byFile of this.citationsByKey.values()) {
			for (const list of byFile.values()) {
				totalCitations += list.length;
			}
		}
		const totalSources = this.entriesByKey.size;
		return {
			totalSources,
			usedSources,
			unusedSources: totalSources - usedSources,
			totalCitations,
			undefinedKeys: this.getUndefinedKeys().length,
		};
	}

	/** Total number of citations for a key across all files. */
	getCount(key: string): number {
		const byFile = this.citationsByKey.get(key);
		if (!byFile) {
			return 0;
		}
		let total = 0;
		for (const list of byFile.values()) {
			total += list.length;
		}
		return total;
	}

	/** All citation instances for a key, ordered by file then position. */
	getCitations(key: string): Citation[] {
		const byFile = this.citationsByKey.get(key);
		if (!byFile) {
			return [];
		}
		const all: Citation[] = [];
		for (const list of byFile.values()) {
			all.push(...list);
		}
		all.sort(
			(a, b) =>
				a.filePath.localeCompare(b.filePath) ||
				a.line - b.line ||
				a.character - b.character,
		);
		return all;
	}

	/** Keys that are cited somewhere but not declared in any `.bib` file. */
	getUndefinedKeys(): string[] {
		const undefinedKeys: string[] = [];
		for (const key of this.citationsByKey.keys()) {
			if (!this.entriesByKey.has(key)) {
				undefinedKeys.push(key);
			}
		}
		return undefinedKeys.sort((a, b) => a.localeCompare(b));
	}

	/** True once at least one `.bib` file has been indexed. */
	hasBibliography(): boolean {
		return this.entriesByBibFile.size > 0;
	}
}
