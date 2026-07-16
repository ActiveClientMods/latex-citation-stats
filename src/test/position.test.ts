import * as assert from 'assert';
import { buildLineIndex, offsetToPosition, getLineText } from '../util/position.js';

suite('util/position', () => {
	test('offsetToPosition maps offsets to 0-based line/column across line endings and boundaries', () => {
		const cases: Array<{ label: string; text: string; offset: number; line: number; character: number }> = [
			{ label: 'single line, start', text: 'hello world', offset: 0, line: 0, character: 0 },
			{ label: 'single line, mid', text: 'hello world', offset: 6, line: 0, character: 6 },
			{ label: 'LF: newline char stays on its line', text: 'ab\ncde\nf', offset: 2, line: 0, character: 2 },
			{ label: 'LF: first char of next line', text: 'ab\ncde\nf', offset: 3, line: 1, character: 0 },
			{ label: 'LF: last line', text: 'ab\ncde\nf', offset: 7, line: 2, character: 0 },
			{ label: 'CRLF: first char after \\r\\n', text: 'ab\r\ncd', offset: 4, line: 1, character: 0 },
			{ label: 'empty string', text: '', offset: 0, line: 0, character: 0 },
			{ label: 'run of blank lines', text: '\n\n\nx', offset: 3, line: 3, character: 0 },
		];
		for (const c of cases) {
			assert.deepStrictEqual(offsetToPosition(buildLineIndex(c.text), c.offset), { line: c.line, character: c.character }, c.label);
		}
	});

	test('getLineText returns the trimmed content of a line, stripping trailing \\r', () => {
		const cases: Array<{ label: string; text: string; line: number; expected: string }> = [
			{ label: 'trims surrounding whitespace', text: 'first\n   middle  \nlast', line: 1, expected: 'middle' },
			{ label: 'strips trailing \\r on CRLF', text: 'one\r\ntwo\r\n', line: 0, expected: 'one' },
			{ label: 'last line without trailing newline', text: 'a\nbee', line: 1, expected: 'bee' },
			{ label: 'blank line yields empty string', text: 'a\n\nb', line: 1, expected: '' },
		];
		for (const c of cases) {
			assert.strictEqual(getLineText(buildLineIndex(c.text), c.line), c.expected, c.label);
		}
	});
});
