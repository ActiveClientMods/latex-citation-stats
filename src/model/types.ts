// Pure data model shared across the extension.
// Intentionally free of any `vscode` imports so the parsers stay side-effect
// free and unit-testable without the VS Code runtime.

/** A single bibliography entry parsed from a `.bib` file. */
export interface BibEntry {
	/** The citation key, e.g. `knuth1984`. */
	key: string;
	/** The BibTeX entry type, lower-cased, e.g. `article`, `book`. */
	entryType: string;
	/** Optional human-readable title, used to enrich the label and to search/sort by. */
	title?: string;
	/** Optional raw `author` field, used to search and to sort by author name. */
	author?: string;
	/** Optional publication year parsed from the `year` field, used to search and sort. */
	year?: number;
	/** Absolute filesystem path of the `.bib` file that declares this entry. */
	filePath: string;
	/** 0-based line of the key in its `@type{key,` declaration. */
	line: number;
	/** 0-based column where the key starts. */
	character: number;
	/** 0-based column just past the end of the key. */
	endCharacter: number;
}

/** A single use of a citation key inside a `.tex` file. */
export interface Citation {
	/** The cited key (may or may not exist in the `.bib` files). */
	key: string;
	/** The LaTeX command used, without the leading backslash, e.g. `cite`, `textcite`. */
	command: string;
	/** Absolute filesystem path of the `.tex` file containing the citation. */
	filePath: string;
	/** 0-based line of the key. */
	line: number;
	/** 0-based column where the key starts. */
	character: number;
	/** 0-based column just past the end of the key. */
	endCharacter: number;
	/** Trimmed source line, shown as a preview under the occurrence. */
	lineText: string;
}

/** A `.bib` entry paired with its live citation count, for the source list. */
export interface EntryWithCount {
	entry: BibEntry;
	count: number;
}

/** Aggregate figures shown in the Overview node and the view header. */
export interface CitationStats {
	/** Unique entries declared across all `.bib` files. */
	totalSources: number;
	/** Declared entries cited at least once. */
	usedSources: number;
	/** Declared entries never cited. */
	unusedSources: number;
	/** Total citation occurrences across every `.tex` file. */
	totalCitations: number;
	/** Keys cited somewhere but declared nowhere. */
	undefinedKeys: number;
}

/** How the source list is ordered by the index's read model. */
export type SortOrder = 'usage' | 'alphabetical';

/**
 * A reference to something in the citations view that a command can act on.
 *
 * The webview builds these payloads ({ kind: 'entry', key }, { kind: 'citation',
 * citation }, …) when it asks the extension to navigate or copy, so a single set
 * of handlers in `commands.ts` serves every row type. Keeping the type here
 * keeps `commands.ts` and the view provider free of a circular import.
 */
export type CitationNode =
	| { readonly kind: 'entry'; readonly key: string }
	| { readonly kind: 'undefinedKey'; readonly key: string }
	| { readonly kind: 'citation'; readonly citation: Citation };
