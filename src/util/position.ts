// Fast offset -> (line, character) conversion.
//
// Parsers work on raw file text (they never hold a `vscode.TextDocument`), so
// we compute an array of line-start offsets once per file and binary-search it
// to turn a match offset into a 0-based line/column pair. This keeps per-match
// conversion at O(log n) instead of rescanning the text for newlines.

export interface LineIndex {
	readonly text: string;
	readonly lineStarts: number[];
}

/** Build a reusable line index for a file's text. */
export function buildLineIndex(text: string): LineIndex {
	const lineStarts: number[] = [0];
	for (let i = 0; i < text.length; i++) {
		// 10 === '\n'. `\r` is left attached to the previous line and trimmed
		// away wherever line text is displayed.
		if (text.charCodeAt(i) === 10) {
			lineStarts.push(i + 1);
		}
	}
	return { text, lineStarts };
}

/** Convert an absolute character offset into a 0-based line/column position. */
export function offsetToPosition(index: LineIndex, offset: number): { line: number; character: number } {
	const { lineStarts } = index;
	// Binary search for the greatest line start that is <= offset.
	let lo = 0;
	let hi = lineStarts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (lineStarts[mid] <= offset) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return { line: lo, character: offset - lineStarts[lo] };
}

/** Return the trimmed text of the given 0-based line. */
export function getLineText(index: LineIndex, line: number): string {
	const { text, lineStarts } = index;
	const start = lineStarts[line];
	const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
	return text.slice(start, end).replace(/\r?\n$/, '').trim();
}
