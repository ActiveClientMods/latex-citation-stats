import * as assert from 'assert';
import { CitationIndex } from '../model/citationIndex.js';
import type { BibEntry, Citation } from '../model/types.js';

// --- tiny factory helpers -------------------------------------------------

function entry(key: string, filePath = '/ws/refs.bib', title?: string): BibEntry {
	return { key, entryType: 'article', title, filePath, line: 0, character: 0, endCharacter: key.length };
}

function cite(key: string, filePath: string, line = 0, character = 0): Citation {
	return { key, command: 'cite', filePath, line, character, endCharacter: character + key.length, lineText: `\\cite{${key}}` };
}

suite('CitationIndex', () => {
	suite('bibliography side', () => {
		test('entries surface with a zero count until cited; hasBibliography tracks indexing', () => {
			const idx = new CitationIndex();
			assert.strictEqual(idx.hasBibliography(), false);
			idx.updateBibFile('/ws/refs.bib', [entry('a'), entry('b')]);
			assert.strictEqual(idx.hasBibliography(), true);
			assert.deepStrictEqual(idx.getEntriesWithCounts().map((e) => [e.entry.key, e.count]), [['a', 0], ['b', 0]]);
		});

		test('a key duplicated across bib files resolves to the first declaration', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/one.bib', [entry('dup', '/ws/one.bib', 'First')]);
			idx.updateBibFile('/ws/two.bib', [entry('dup', '/ws/two.bib', 'Second')]);
			const dup = idx.getEntriesWithCounts().filter((e) => e.entry.key === 'dup');
			assert.deepStrictEqual([dup.length, dup[0].entry.title], [1, 'First']);
		});

		test('removeBibFile drops that file\'s entries and rebuilds the merged view (unknown path is a no-op)', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/a.bib', [entry('a', '/ws/a.bib')]);
			idx.updateBibFile('/ws/b.bib', [entry('b', '/ws/b.bib')]);
			idx.removeBibFile('/ws/missing.bib'); // no-op
			idx.removeBibFile('/ws/a.bib');
			assert.deepStrictEqual(idx.getEntriesWithCounts().map((e) => e.entry.key), ['b']);
		});
	});

	suite('counting citations', () => {
		test('counts uses within and across files', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('a')]);
			idx.updateTexFile('/ws/one.tex', [cite('a', '/ws/one.tex'), cite('a', '/ws/one.tex', 1)]);
			idx.updateTexFile('/ws/two.tex', [cite('a', '/ws/two.tex')]);
			assert.strictEqual(idx.getCount('a'), 3);
		});
	});

	suite('delta merge (the core caching guarantee)', () => {
		test('re-updating the same file REPLACES its slice (no double counting)', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('a')]);
			idx.updateTexFile('/ws/m.tex', [cite('a', '/ws/m.tex'), cite('a', '/ws/m.tex', 1)]);
			assert.strictEqual(idx.getCount('a'), 2);
			idx.updateTexFile('/ws/m.tex', [cite('a', '/ws/m.tex')]); // edit: now cites once
			assert.strictEqual(idx.getCount('a'), 1);
		});

		test('a key removed from a file no longer contributes to its count', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('a'), entry('b')]);
			idx.updateTexFile('/ws/m.tex', [cite('a', '/ws/m.tex'), cite('b', '/ws/m.tex')]);
			idx.updateTexFile('/ws/m.tex', [cite('a', '/ws/m.tex')]); // 'b' removed
			assert.deepStrictEqual([idx.getCount('a'), idx.getCount('b')], [1, 0]);
		});

		test('editing one file does not disturb another file\'s citations of the same key', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('a')]);
			idx.updateTexFile('/ws/one.tex', [cite('a', '/ws/one.tex')]);
			idx.updateTexFile('/ws/two.tex', [cite('a', '/ws/two.tex')]);
			idx.updateTexFile('/ws/one.tex', []); // clear one.tex only
			assert.strictEqual(idx.getCount('a'), 1);
		});

		test('removeTexFile removes all of that file\'s contributions (unknown path is a no-op)', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('a'), entry('b')]);
			idx.updateTexFile('/ws/m.tex', [cite('a', '/ws/m.tex'), cite('b', '/ws/m.tex')]);
			idx.removeTexFile('/ws/nope.tex'); // no-op
			idx.removeTexFile('/ws/m.tex');
			assert.deepStrictEqual([idx.getCount('a'), idx.getCount('b')], [0, 0]);
		});
	});

	suite('read model for the tree', () => {
		test('getCitations is sorted by file, then line, then column (empty for uncited keys)', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('a')]);
			idx.updateTexFile('/ws/b.tex', [cite('a', '/ws/b.tex', 3, 2)]);
			idx.updateTexFile('/ws/a.tex', [cite('a', '/ws/a.tex', 5, 0), cite('a', '/ws/a.tex', 1, 9), cite('a', '/ws/a.tex', 1, 0)]);
			assert.deepStrictEqual(
				idx.getCitations('a').map((c) => [c.filePath, c.line, c.character]),
				[
					['/ws/a.tex', 1, 0],
					['/ws/a.tex', 1, 9],
					['/ws/a.tex', 5, 0],
					['/ws/b.tex', 3, 2],
				],
			);
			assert.deepStrictEqual(idx.getCitations('ghost'), []);
		});

		test('entries are ordered most-cited first, unused last, ties broken alphabetically', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('zebra'), entry('apple'), entry('mango'), entry('unused')]);
			idx.updateTexFile('/ws/m.tex', [
				cite('apple', '/ws/m.tex'),
				cite('apple', '/ws/m.tex', 1),
				cite('mango', '/ws/m.tex', 2),
				cite('zebra', '/ws/m.tex', 3),
				cite('zebra', '/ws/m.tex', 4),
			]);
			assert.deepStrictEqual(idx.getEntriesWithCounts().map((e) => [e.entry.key, e.count]), [
				['apple', 2],
				['zebra', 2],
				['mango', 1],
				['unused', 0],
			]);
			// 'alphabetical' ignores counts entirely.
			assert.deepStrictEqual(idx.getEntriesWithCounts('alphabetical').map((e) => e.entry.key), [
				'apple',
				'mango',
				'unused',
				'zebra',
			]);
		});

		test('getEntry resolves a declared key and returns undefined otherwise', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('known', '/ws/refs.bib', 'Known Title')]);
			assert.strictEqual(idx.getEntry('known')?.title, 'Known Title');
			assert.strictEqual(idx.getEntry('ghost'), undefined);
		});
	});

	suite('statistics', () => {
		test('reports totals, used/unused split, occurrences, and undefined keys', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('a'), entry('b'), entry('unused')]);
			idx.updateTexFile('/ws/one.tex', [cite('a', '/ws/one.tex'), cite('a', '/ws/one.tex', 1), cite('b', '/ws/one.tex', 2)]);
			idx.updateTexFile('/ws/two.tex', [cite('ghost', '/ws/two.tex')]);

			assert.deepStrictEqual(idx.getStats(), {
				totalSources: 3,
				usedSources: 2,
				unusedSources: 1,
				totalCitations: 4, // includes the occurrence of the undeclared 'ghost'
				undefinedKeys: 1,
			});
		});

		test('an empty index reports all zeroes', () => {
			assert.deepStrictEqual(new CitationIndex().getStats(), {
				totalSources: 0,
				usedSources: 0,
				unusedSources: 0,
				totalCitations: 0,
				undefinedKeys: 0,
			});
		});
	});

	suite('undefined citations', () => {
		test('cited-but-undeclared keys are reported sorted', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('known')]);
			idx.updateTexFile('/ws/m.tex', [cite('known', '/ws/m.tex'), cite('zztop', '/ws/m.tex'), cite('acme', '/ws/m.tex')]);
			assert.deepStrictEqual(idx.getUndefinedKeys(), ['acme', 'zztop']);
		});

		test('a key toggles defined/undefined as its bib entry appears and disappears', () => {
			const idx = new CitationIndex();
			idx.updateTexFile('/ws/m.tex', [cite('x', '/ws/m.tex')]);
			assert.deepStrictEqual(idx.getUndefinedKeys(), ['x']);
			idx.updateBibFile('/ws/refs.bib', [entry('x')]);
			assert.deepStrictEqual(idx.getUndefinedKeys(), []);
			idx.removeBibFile('/ws/refs.bib');
			assert.deepStrictEqual(idx.getUndefinedKeys(), ['x']);
		});
	});
});
