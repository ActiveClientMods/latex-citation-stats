import type { BibEntry } from '../model/types.js';
import { buildLineIndex, offsetToPosition } from '../util/position.js';

// `.bib` parser.
//
// BibTeX is not a regular language (values can nest braces arbitrarily), so we
// use a regex only to *locate* entry starts and then do a small brace-depth
// scan to isolate each entry block. That keeps the extraction robust against
// nested braces in titles like `{The {LaTeX} Companion}`.

const ENTRY_START = /@(\w+)\s*\{/g;
const SKIP_TYPES = new Set(['comment', 'string', 'preamble']);

/**
 * Parse every citable entry in a `.bib` file's text.
 *
 * @param text     Raw file contents.
 * @param filePath Absolute path, stamped onto each returned entry.
 */
export function parseBib(text: string, filePath: string): BibEntry[] {
	const entries: BibEntry[] = [];
	const lineIndex = buildLineIndex(text);

	ENTRY_START.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ENTRY_START.exec(text)) !== null) {
		const entryType = match[1].toLowerCase();
		const openBrace = match.index + match[0].length - 1;
		const block = extractBraceBlock(text, openBrace);
		if (!block) {
			continue;
		}
		// Resume scanning past this entry regardless of whether we keep it.
		ENTRY_START.lastIndex = block.end;

		if (SKIP_TYPES.has(entryType)) {
			continue;
		}

		const commaIdx = block.content.indexOf(',');
		const rawKey = commaIdx === -1 ? block.content : block.content.slice(0, commaIdx);
		const key = rawKey.trim();
		if (!key) {
			continue;
		}

		// Position of the key itself (not the `@type`), so navigation can land on
		// and select it exactly.
		const keyOffset = openBrace + 1 + (rawKey.length - rawKey.trimStart().length);
		const position = offsetToPosition(lineIndex, keyOffset);

		entries.push({
			key,
			entryType,
			title: extractField(block.content, 'title'),
			author: extractField(block.content, 'author'),
			year: parseYear(extractField(block.content, 'year')),
			filePath,
			line: position.line,
			character: position.character,
			endCharacter: position.character + key.length,
		});
	}

	return entries;
}

/**
 * Given the index of an opening `{`, return the block's inner content and the
 * offset just past its matching `}`. Returns `undefined` if unbalanced.
 */
function extractBraceBlock(text: string, openIndex: number): { content: string; end: number } | undefined {
	let depth = 0;
	for (let i = openIndex; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 123 /* { */) {
			depth++;
		} else if (ch === 125 /* } */) {
			depth--;
			if (depth === 0) {
				return { content: text.slice(openIndex + 1, i), end: i + 1 };
			}
		}
	}
	return undefined;
}

/**
 * Extract a field value (`title = {..}`, `title = ".."`, or a bare value) from
 * an entry block. Handles nested braces in the value.
 */
function extractField(block: string, field: string): string | undefined {
	const re = new RegExp(`\\b${field}\\s*=\\s*`, 'i');
	const m = re.exec(block);
	if (!m) {
		return undefined;
	}
	let i = m.index + m[0].length;
	const first = block[i];

	let raw: string;
	if (first === '{') {
		const block2 = extractBraceBlock(block, i);
		if (!block2) {
			return undefined;
		}
		raw = block2.content;
	} else if (first === '"') {
		const endQuote = block.indexOf('"', i + 1);
		raw = endQuote === -1 ? block.slice(i + 1) : block.slice(i + 1, endQuote);
	} else {
		// Bare value: read up to the next comma or end of block.
		const comma = block.indexOf(',', i);
		raw = (comma === -1 ? block.slice(i) : block.slice(i, comma)).trim();
	}

	// Collapse remaining braces/whitespace used for BibTeX capitalization control.
	const cleaned = raw.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
	return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Pull a 4-digit year out of a raw `year` value (`{1984}`, `1984`, `1984--1985`,
 * or biblatex `date` remnants like `2001-05`). Returns `undefined` if none.
 */
function parseYear(raw: string | undefined): number | undefined {
	if (!raw) {
		return undefined;
	}
	const m = /\d{4}/.exec(raw);
	return m ? Number(m[0]) : undefined;
}
