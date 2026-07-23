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
	/** Trimmed source line, shown as a preview in the tree. */
	lineText: string;
}

/** A `.bib` entry paired with its live citation count, for the tree root. */
export interface EntryWithCount {
	entry: BibEntry;
	count: number;
}

/** Aggregate figures shown in the tree's Overview node and the view header. */
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

/** How the source list is ordered in the tree. */
export type SortOrder = 'usage' | 'alphabetical';

/**
 * A node in the citations tree.
 *
 * Command handlers accept these nodes as their argument: the citation webview
 * builds node-shaped payloads ({ kind: 'citation', citation }, { kind: 'entry',
 * key }) when it asks the extension to navigate or copy, so a single set of
 * handlers in `commands.ts` serves the view. Keeping the type here keeps
 * `commands.ts` and the view provider free of a circular import.
 */
export type TreeNode =
	| { readonly kind: 'stats' }
	| { readonly kind: 'statLine'; readonly label: string; readonly value: number; readonly icon: string }
	| { readonly kind: 'entry'; readonly key: string }
	| { readonly kind: 'undefinedRoot' }
	| { readonly kind: 'undefinedKey'; readonly key: string }
	| { readonly kind: 'citation'; readonly citation: Citation; readonly orphan?: boolean };
