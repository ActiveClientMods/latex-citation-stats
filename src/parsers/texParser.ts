import type { Citation } from '../model/types.js';
import { buildLineIndex, getLineText, offsetToPosition, type LineIndex } from '../util/position.js';

// `.tex` citation parser.
//
// A regex locates each `\...cite...` command; the argument list after it is then
// walked by a small scanner. A single regex cannot do this correctly because
// biblatex's *multicite* commands take a REPEATING sequence of optional
// arguments and key groups:
//
//   \cites[S.~12-22]{key1}[S.~1]{key2}
//   \cites[S.~12-22]{key1}{key2}
//   \cites(pre)(post)[a][b]{key1}[c]{key2}
//
// Repetition is applied only to the known multicite commands. For ordinary
// commands exactly one key group is consumed, so `\cite{a}{b}` does not
// mistake the following brace group for citation keys.

const CITE_COMMAND = /\\([A-Za-z]*cite[A-Za-z]*)/gi;

/** biblatex commands that accept a repeating `[opt]...{keys}` sequence. */
const MULTICITE_COMMANDS = new Set([
	'cites',
	'parencites',
	'textcites',
	'smartcites',
	'autocites',
	'footcites',
	'footcitetexts',
	'supercites',
	'fullcites',
	'notecites',
	'pnotecites',
	'fnotecites',
	'volcites',
	'avolcites',
]);

/** Commands that contain "cite" but take no citation keys. */
const NON_CITING_COMMANDS = new Set(['citestyle', 'citereset', 'citeresetall']);

/**
 * Parse all citations in a `.tex` file's text.
 *
 * @param text     Raw file contents.
 * @param filePath Absolute path, stamped onto each returned citation.
 */
export function parseTex(text: string, filePath: string): Citation[] {
	// Blank out comments first so `% \cite{ignored}` is not counted, while
	// keeping every offset identical (comments are replaced space-for-space).
	const clean = blankComments(text);
	const lineIndex = buildLineIndex(text);
	const citations: Citation[] = [];

	CITE_COMMAND.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = CITE_COMMAND.exec(clean)) !== null) {
		const command = match[1];
		if (NON_CITING_COMMANDS.has(command.toLowerCase())) {
			continue;
		}
		const multi = MULTICITE_COMMANDS.has(command.toLowerCase());
		let pos = match.index + match[0].length;

		// Multicite commands may lead with (multiprenote)(multipostnote).
		if (multi) {
			pos = skipParenArgs(clean, pos);
		}

		let consumedAny = false;
		for (;;) {
			const group = nextKeyGroup(clean, pos);
			if (!group) {
				break;
			}
			collectKeys(clean, group.start, group.end, command, filePath, lineIndex, citations);
			pos = group.after;
			consumedAny = true;
			if (!multi) {
				break;
			}
		}

		// Resume scanning past everything we consumed.
		if (consumedAny) {
			CITE_COMMAND.lastIndex = pos;
		}
	}

	return citations;
}

/**
 * From `pos`, skip whitespace and any number of `[...]` optional arguments, then
 * return the bounds of the `{...}` key group. Returns `undefined` if no key
 * group follows (so trailing text is never mistaken for keys).
 */
function nextKeyGroup(text: string, pos: number): { start: number; end: number; after: number } | undefined {
	let i = skipWhitespace(text, pos);
	while (text[i] === '[') {
		const close = text.indexOf(']', i + 1);
		if (close === -1) {
			return undefined;
		}
		i = skipWhitespace(text, close + 1);
	}
	if (text[i] !== '{') {
		return undefined;
	}
	const end = matchBrace(text, i);
	if (end === -1) {
		return undefined;
	}
	return { start: i + 1, end, after: end + 1 };
}

/** Consume up to two `(...)` multinote arguments that directly follow a multicite command. */
function skipParenArgs(text: string, pos: number): number {
	let i = pos;
	for (let n = 0; n < 2; n++) {
		if (text[i] !== '(') {
			break;
		}
		const close = text.indexOf(')', i + 1);
		if (close === -1) {
			break;
		}
		i = close + 1;
	}
	return i;
}

/** Split a `{a, b, c}` group into one Citation per key, each with its own column. */
function collectKeys(
	text: string,
	start: number,
	end: number,
	command: string,
	filePath: string,
	lineIndex: LineIndex,
	out: Citation[],
): void {
	const raw = text.slice(start, end);
	let cursor = 0;
	for (const part of raw.split(',')) {
		const leading = part.length - part.trimStart().length;
		const key = part.trim();
		// `\nocite{*}` means "everything"; it is not a real key.
		if (key && key !== '*') {
			const offset = start + cursor + leading;
			const position = offsetToPosition(lineIndex, offset);
			out.push({
				key,
				command,
				filePath,
				line: position.line,
				character: position.character,
				endCharacter: position.character + key.length,
				lineText: getLineText(lineIndex, position.line),
			});
		}
		cursor += part.length + 1; // account for the split comma
	}
}

/** Index of the `}` matching the `{` at `openIndex`, or -1 when unbalanced. */
function matchBrace(text: string, openIndex: number): number {
	let depth = 0;
	for (let i = openIndex; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 123 /* { */) {
			depth++;
		} else if (ch === 125 /* } */) {
			depth--;
			if (depth === 0) {
				return i;
			}
		}
	}
	return -1;
}

function skipWhitespace(text: string, pos: number): number {
	let i = pos;
	while (i < text.length && /\s/.test(text[i])) {
		i++;
	}
	return i;
}

/**
 * Return a same-length copy of `text` with LaTeX comments (unescaped `%` to end
 * of line) replaced by spaces, preserving every offset.
 */
function blankComments(text: string): string {
	const out = text.split('');
	let inComment = false;
	for (let i = 0; i < out.length; i++) {
		const ch = out[i];
		if (ch === '\n') {
			inComment = false;
			continue;
		}
		if (inComment) {
			out[i] = ' ';
			continue;
		}
		if (ch === '%' && (i === 0 || out[i - 1] !== '\\')) {
			inComment = true;
			out[i] = ' ';
		}
	}
	return out.join('');
}
