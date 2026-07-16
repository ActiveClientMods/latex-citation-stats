import * as assert from 'assert';
import { parseTex } from '../parsers/texParser.js';

const F = '/ws/main.tex';

suite('parsers/texParser', () => {
	test('recognises the whole \\...cite... family, including capitalized biblatex variants', () => {
		const commands = ['cite', 'citep', 'citet', 'textcite', 'parencite', 'autocite', 'footcite', 'nocite', 'citeauthor', 'Textcite', 'Parencite'];
		for (const cmd of commands) {
			const [c] = parseTex(`\\${cmd}{k}`, F);
			assert.strictEqual(c?.command, cmd, `expected \\${cmd} to be parsed`);
			assert.strictEqual(c?.key, 'k', `expected key from \\${cmd}`);
		}
	});

	test('computes exact 0-based line/column, endCharacter, and a trimmed preview', () => {
		const [c] = parseTex('  \\cite{abc}', F);
		assert.deepStrictEqual(
			{ key: c.key, command: c.command, line: c.line, character: c.character, endCharacter: c.endCharacter, filePath: c.filePath },
			{ key: 'abc', command: 'cite', line: 0, character: 8, endCharacter: 11, filePath: F },
		);

		// Distinct lines and distinct columns on the same line.
		const multi = parseTex('intro\n\\cite{a} and \\cite{b}', F);
		assert.deepStrictEqual(multi.map((x) => [x.key, x.line, x.character]), [
			['a', 1, 6],
			['b', 1, 19],
		]);

		assert.strictEqual(parseTex('   Look at \\cite{k} here   ', F)[0].lineText, 'Look at \\cite{k} here');
	});

	test('splits comma-separated groups into per-key citations with correct columns and shared command', () => {
		//                                     \parencite{aa, bb,cc}
		const cites = parseTex('\\parencite{aa, bb,cc}', F);
		assert.deepStrictEqual(cites.map((c) => [c.command, c.key, c.character]), [
			['parencite', 'aa', 11],
			['parencite', 'bb', 15],
			['parencite', 'cc', 18],
		]);
	});

	test('skips optional pre-/post-note arguments before the key group', () => {
		// '{' sits at index 11 in "\cite[p.~5]{key}", so 'key' starts at column 12.
		const single = parseTex('\\cite[p.~5]{key}', F)[0];
		assert.deepStrictEqual([single.key, single.character], ['key', 12]);
		assert.strictEqual(parseTex('\\autocite[see][p.~5]{key}', F)[0].key, 'key');
	});

	test('respects LaTeX comments while preserving offsets', () => {
		const cases: Array<{ label: string; src: string; keys: string[]; line?: number }> = [
			{ label: 'whole-line comment ignored, next line counted', src: '% \\cite{hidden}\n\\cite{real}', keys: ['real'], line: 1 },
			{ label: 'mid-line: before % counts, after % does not', src: '\\cite{real} % \\cite{fake}', keys: ['real'] },
			{ label: 'escaped \\% is not a comment', src: '50\\% agree \\cite{real}', keys: ['real'] },
		];
		for (const c of cases) {
			const cites = parseTex(c.src, F);
			assert.deepStrictEqual(cites.map((x) => x.key), c.keys, c.label);
			if (c.line !== undefined) {
				assert.strictEqual(cites[0].line, c.line, `${c.label} (line)`);
			}
		}
	});

	test('tolerates surrounding whitespace and preserves punctuation in keys', () => {
		assert.strictEqual(parseTex('\\cite {k}', F)[0].key, 'k'); // space before brace
		const padded = parseTex('\\cite{   spaced   }', F)[0];
		assert.deepStrictEqual([padded.key, padded.character], ['spaced', 9]); // trimmed, column at first non-space
		assert.strictEqual(parseTex('\\cite{a_b:c/d.e}', F)[0].key, 'a_b:c/d.e');
	});

	test('produces no citations for empty groups, non-cite commands, or empty input', () => {
		const none = [
			'', // empty document
			'\\section{Intro}\nSome text.', // no citations
			'\\cite{}', // empty braces
			'\\cite{ , , }', // only separators/whitespace
			'\\ref{fig:1}\\label{eq:2}\\includegraphics{img}', // non-cite commands
		];
		for (const src of none) {
			assert.deepStrictEqual(parseTex(src, F), [], JSON.stringify(src));
		}
		// Empty slots inside a group are dropped; real keys are kept.
		assert.deepStrictEqual(parseTex('\\cite{a,,b,}', F).map((c) => c.key), ['a', 'b']);
	});
});
