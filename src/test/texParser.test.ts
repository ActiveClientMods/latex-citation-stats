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

	suite('multicite commands (\\cites and friends)', () => {
		test('collects every key from alternating [opt]{key} groups', () => {
			//                     \cites[S.~12-22]{key1}[S.~1]{key2}
			// indices:            0.....6........15|16 17..20 21|22..27|28 29..32
			const cites = parseTex('\\cites[S.~12-22]{key1}[S.~1]{key2}', F);
			assert.deepStrictEqual(cites.map((c) => [c.command, c.key, c.character]), [
				['cites', 'key1', 17],
				['cites', 'key2', 29],
			]);
		});

		test('collects consecutive key groups with a single leading optional arg', () => {
			//                     \cites[S.~12-22]{key1}{key2}
			const cites = parseTex('\\cites[S.~12-22]{key1}{key2}', F);
			assert.deepStrictEqual(cites.map((c) => [c.key, c.character]), [
				['key1', 17],
				['key2', 23],
			]);
		});

		test('commas inside an optional argument are never treated as keys', () => {
			//                     \cites[S.~4,6,19]{key1}
			const cites = parseTex('\\cites[S.~4,6,19]{key1}', F);
			assert.deepStrictEqual(cites.map((c) => [c.key, c.character]), [['key1', 18]]);
		});

		test('supports multi-key groups, per-group notes, and (multinote) prefixes', () => {
			assert.deepStrictEqual(parseTex('\\cites{a,b}{c}', F).map((c) => c.key), ['a', 'b', 'c']);
			assert.deepStrictEqual(
				parseTex('\\autocites[1]{a}[S.~2-3]{b}[c]{d}', F).map((c) => c.key),
				['a', 'b', 'd'],
			);
			assert.deepStrictEqual(parseTex('\\cites(pre)(post)[1]{a}{b}', F).map((c) => c.key), ['a', 'b']);
		});

		test('works across the multicite family and stops at following text', () => {
			for (const cmd of ['cites', 'parencites', 'textcites', 'autocites', 'footcites', 'supercites', 'Textcites']) {
				assert.deepStrictEqual(parseTex(`\\${cmd}{a}{b}`, F).map((c) => c.key), ['a', 'b'], `\\${cmd}`);
			}
			// A brace group that is not an argument must not be swallowed.
			assert.deepStrictEqual(parseTex('\\cites{a}{b} and \\textbf{bold}', F).map((c) => c.key), ['a', 'b']);
		});

		test('singular commands consume exactly one group, so \\cite{a}{b} ignores {b}', () => {
			assert.deepStrictEqual(parseTex('\\cite{a}{b}', F).map((c) => c.key), ['a']);
		});

		test('multicite keys still resolve to correct lines when spread over lines', () => {
			const cites = parseTex('intro\n\\cites[S.~1]{a}\n  {b}', F);
			assert.deepStrictEqual(cites.map((c) => [c.key, c.line]), [
				['a', 1],
				['b', 2],
			]);
		});
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
			'\\citestyle{authoryear}\\citereset', // "cite" commands that take no keys
			'\\nocite{*}', // wildcard is not a key
			'\\cite', // command with no argument group at all
		];
		for (const src of none) {
			assert.deepStrictEqual(parseTex(src, F), [], JSON.stringify(src));
		}
		// Empty slots inside a group are dropped; real keys are kept.
		assert.deepStrictEqual(parseTex('\\cite{a,,b,}', F).map((c) => c.key), ['a', 'b']);
	});
});
