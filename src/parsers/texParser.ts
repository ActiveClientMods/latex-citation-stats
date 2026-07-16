import type { Citation } from '../types.js';
import { buildLineIndex, getLineText, offsetToPosition } from '../util/position.js';

// `.tex` citation parser.
//
// Matches the whole `\...cite...` family in one pass: any command containing
// "cite" (case-insensitive) — `\cite`, `\citep`, `\citet`, `\textcite`,
// `\parencite`, `\autocite`, `\footcite`, `\nocite`, capitalized biblatex
// variants, etc. Optional pre-arguments (`[p.~5]`, `[see][]`) are skipped, and
// multi-key groups (`\cite{a, b, c}`) are split into one Citation per key with
// its own exact column.

const CITE_RE = /\\([A-Za-z]*cite[A-Za-z]*)\s*((?:\[[^\]]*\])*)\s*\{([^}]*)\}/gi;

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

	CITE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = CITE_RE.exec(clean)) !== null) {
		const command = match[1];
		const keysRaw = match[3];
		// Offset of the first character inside the `{...}` group. `match[0]`
		// ends with the closing `}`, so keysRaw starts that many chars back.
		const groupStart = match.index + match[0].length - 1 - keysRaw.length;

		let cursor = 0;
		for (const part of keysRaw.split(',')) {
			const leading = part.length - part.trimStart().length;
			const key = part.trim();
			if (key) {
				const keyOffset = groupStart + cursor + leading;
				const start = offsetToPosition(lineIndex, keyOffset);
				citations.push({
					key,
					command,
					filePath,
					line: start.line,
					character: start.character,
					endCharacter: start.character + key.length,
					lineText: getLineText(lineIndex, start.line),
				});
			}
			cursor += part.length + 1; // account for the split comma
		}
	}

	return citations;
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
