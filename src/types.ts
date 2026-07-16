// Pure data model shared across the extension.
// Intentionally free of any `vscode` imports so the parsers stay side-effect
// free and unit-testable without the VS Code runtime.

/** A single bibliography entry parsed from a `.bib` file. */
export interface BibEntry {
	/** The citation key, e.g. `knuth1984`. */
	key: string;
	/** The BibTeX entry type, lower-cased, e.g. `article`, `book`. */
	entryType: string;
	/** Optional human-readable title, used to enrich the tree label. */
	title?: string;
	/** Absolute filesystem path of the `.bib` file that declares this entry. */
	filePath: string;
	/** 0-based line of the `@type{...}` declaration (for future navigation). */
	line: number;
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
