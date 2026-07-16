import * as assert from 'assert';
import { parseBib } from '../parsers/bibParser.js';

const F = '/ws/refs.bib';

suite('parsers/bibParser', () => {
	test('parses entry type (lower-cased), key (case preserved), and line number', () => {
		const entries = parseBib('@InProceedings{Smith_2020,\n  title = {X}\n}\n\n@book{b, title={B}}', F);
		assert.deepStrictEqual(
			entries.map((e) => [e.entryType, e.key, e.line, e.filePath]),
			[
				['inproceedings', 'Smith_2020', 0, F],
				['book', 'b', 4, F],
			],
		);
	});

	test('extracts titles across delimiter styles and normalisation rules', () => {
		const cases: Array<{ label: string; src: string; title: string | undefined }> = [
			{ label: 'brace-delimited', src: '@misc{k, title = {Hello World}}', title: 'Hello World' },
			{ label: 'quote-delimited', src: '@misc{k, title = "Hello World"}', title: 'Hello World' },
			{ label: 'nested braces flattened', src: '@misc{k, title = {The {LaTeX} {C}ompanion}}', title: 'The LaTeX Companion' },
			{ label: 'bare value ends at comma', src: '@misc{k, title = Plain, year = 2020}', title: 'Plain' },
			{ label: 'internal whitespace collapsed', src: '@misc{k, title = {Line one\n   line two}}', title: 'Line one line two' },
			{ label: 'field name is case-insensitive', src: '@misc{k, Title = {Cased}}', title: 'Cased' },
			{ label: 'missing title is undefined', src: '@misc{k, year = {2020}}', title: undefined },
		];
		for (const c of cases) {
			assert.strictEqual(parseBib(c.src, F)[0].title, c.title, c.label);
		}
	});

	test('ignores @comment, @string and @preamble constructs', () => {
		const text = ['@comment{ignored}', '@string{pub = "ACM"}', '@preamble{"\\x"}', '@article{real, title={Real}}'].join('\n');
		assert.deepStrictEqual(parseBib(text, F).map((e) => e.key), ['real']);
	});

	test('tolerates loose formatting and punctuation in keys', () => {
		const cases: Array<{ label: string; src: string; key: string }> = [
			{ label: 'whitespace around type and key', src: '@article {  spaced  , title={T}}', key: 'spaced' },
			{ label: 'key only, no fields or comma', src: '@misc{lonely}', key: 'lonely' },
			{ label: 'punctuation in key preserved', src: '@article{author:2021/v2, title={P}}', key: 'author:2021/v2' },
		];
		for (const c of cases) {
			assert.strictEqual(parseBib(c.src, F)[0].key, c.key, c.label);
		}
	});

	test('returns duplicate keys as separate entries (de-duplication is the index\'s job)', () => {
		assert.strictEqual(parseBib('@misc{dup, title={First}}\n@misc{dup, title={Second}}', F).length, 2);
	});

	test('handles malformed / empty input without throwing', () => {
		const empty: Array<{ label: string; src: string }> = [
			{ label: 'empty string', src: '' },
			{ label: 'prose with no entries', src: 'just some prose, no bib here' },
			{ label: 'unbalanced opening brace', src: '@article{oops, title={Unclosed' },
			{ label: 'empty key (bare comma)', src: '@misc{, title={x}}' },
		];
		for (const c of empty) {
			assert.doesNotThrow(() => parseBib(c.src, F), c.label);
			assert.deepStrictEqual(parseBib(c.src, F), [], c.label);
		}
		// A well-formed entry after a closed one still parses.
		assert.deepStrictEqual(parseBib('@article{good, title={G}}\n@book{good2, title={G2}}', F).map((e) => e.key), ['good', 'good2']);
	});
});
