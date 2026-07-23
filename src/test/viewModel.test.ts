import * as assert from 'assert';
import { CitationIndex } from '../model/citationIndex.js';
import { DEFAULT_STATE, authorSortKey, buildViewModel, type ViewState } from '../model/viewModel.js';
import type { BibEntry, Citation } from '../model/types.js';

function entry(key: string, extra: Partial<BibEntry> = {}): BibEntry {
	return { key, entryType: 'article', filePath: '/ws/refs.bib', line: 0, character: 0, endCharacter: key.length, ...extra };
}
function cite(key: string, line = 0): Citation {
	return { key, command: 'cite', filePath: '/ws/main.tex', line, character: 0, endCharacter: key.length, lineText: `\\cite{${key}}` };
}
function state(overrides: Partial<ViewState> = {}): ViewState {
	return { ...DEFAULT_STATE, ...overrides };
}

suite('viewModel', () => {
	suite('search matcher', () => {
		function idx(): CitationIndex {
			const i = new CitationIndex();
			i.updateBibFile('/ws/refs.bib', [
				entry('knuth1984', { title: 'The TeXbook', author: 'Knuth, Donald E.', year: 1984 }),
				entry('lamport1994', { title: 'LaTeX', author: 'Lamport, Leslie', year: 1994 }),
			]);
			i.updateTexFile('/ws/main.tex', [cite('knuth1984')]);
			return i;
		}

		test('empty query matches every source', () => {
			const m = buildViewModel(idx(), state());
			assert.deepStrictEqual(m.entries.map((e) => e.key).sort(), ['knuth1984', 'lamport1994']);
			assert.strictEqual(m.filtering, false);
		});

		test('substring search matches across key, title, author and year', () => {
			const byTitle = buildViewModel(idx(), state({ query: 'texbook' }));
			assert.deepStrictEqual(byTitle.entries.map((e) => e.key), ['knuth1984']);
			const byAuthor = buildViewModel(idx(), state({ query: 'lamport' }));
			assert.deepStrictEqual(byAuthor.entries.map((e) => e.key), ['lamport1994']);
			const byYear = buildViewModel(idx(), state({ query: '1984' }));
			assert.deepStrictEqual(byYear.entries.map((e) => e.key), ['knuth1984']);
			assert.strictEqual(byYear.filtering, true);
		});

		test('Match Case makes the query case-sensitive', () => {
			assert.strictEqual(buildViewModel(idx(), state({ query: 'KNUTH' })).entries.length, 1);
			assert.strictEqual(buildViewModel(idx(), state({ query: 'KNUTH', matchCase: true })).entries.length, 0);
			assert.strictEqual(buildViewModel(idx(), state({ query: 'Knuth', matchCase: true })).entries.length, 1);
		});

		test('Match Whole Word anchors on word boundaries', () => {
			// "Tex" is a substring of both "The TeXbook" and "LaTeX", but a whole
			// word in neither, so Match Whole Word narrows the 2 hits down to 0.
			assert.strictEqual(buildViewModel(idx(), state({ query: 'Tex' })).entries.length, 2);
			assert.strictEqual(buildViewModel(idx(), state({ query: 'Tex', matchWholeWord: true })).entries.length, 0);
			assert.strictEqual(buildViewModel(idx(), state({ query: 'LaTeX', matchWholeWord: true })).entries.length, 1);
		});

		test('regex mode interprets the query as a pattern', () => {
			const m = buildViewModel(idx(), state({ query: '^lam.*94$', useRegex: true }));
			assert.deepStrictEqual(m.entries.map((e) => e.key), ['lamport1994']);
		});

		test('an invalid regex flags regexError and matches nothing (never throws)', () => {
			const m = buildViewModel(idx(), state({ query: '(unclosed', useRegex: true }));
			assert.strictEqual(m.regexError, true);
			assert.strictEqual(m.entries.length, 0);
			assert.strictEqual(m.undefinedKeys.length, 0);
		});

		test('search also filters the undefined-keys section', () => {
			const i = idx();
			i.updateTexFile('/ws/main.tex', [cite('knuth1984'), cite('ghostKey'), cite('otherGhost')]);
			const m = buildViewModel(i, state({ query: 'ghostkey' }));
			assert.deepStrictEqual(m.undefinedKeys.map((u) => u.key), ['ghostKey']);
		});
	});

	suite('filter', () => {
		function idx(): CitationIndex {
			const i = new CitationIndex();
			i.updateBibFile('/ws/refs.bib', [entry('used'), entry('unused')]);
			i.updateTexFile('/ws/main.tex', [cite('used'), cite('ghost')]);
			return i;
		}

		test('all shows every entry plus the undefined section', () => {
			const m = buildViewModel(idx(), state({ filter: 'all' }));
			assert.deepStrictEqual(m.entries.map((e) => e.key).sort(), ['unused', 'used']);
			assert.deepStrictEqual(m.undefinedKeys.map((u) => u.key), ['ghost']);
		});

		test('used shows only cited entries and hides undefined', () => {
			const m = buildViewModel(idx(), state({ filter: 'used' }));
			assert.deepStrictEqual(m.entries.map((e) => e.key), ['used']);
			assert.deepStrictEqual(m.undefinedKeys, []);
		});

		test('unused shows only uncited entries', () => {
			const m = buildViewModel(idx(), state({ filter: 'unused' }));
			assert.deepStrictEqual(m.entries.map((e) => e.key), ['unused']);
		});

		test('undefined shows only the undefined section, no declared entries', () => {
			const m = buildViewModel(idx(), state({ filter: 'undefined' }));
			assert.deepStrictEqual(m.entries, []);
			assert.deepStrictEqual(m.undefinedKeys.map((u) => u.key), ['ghost']);
		});
	});

	suite('sort', () => {
		function idx(): CitationIndex {
			const i = new CitationIndex();
			i.updateBibFile('/ws/refs.bib', [
				entry('a', { title: 'Bravo', author: 'Zeta, A.', year: 2000 }),
				entry('b', { title: 'Alpha', author: 'Adams, B.', year: 2010 }),
				entry('c', { title: 'Charlie', author: 'Mundy, C.', year: 1990 }),
			]);
			// counts: b=3, a=1, c=0
			i.updateTexFile('/ws/main.tex', [cite('a'), cite('b'), cite('b', 1), cite('b', 2)]);
			return i;
		}
		const order = (s: ViewState['sort']) => buildViewModel(idx(), state({ sort: s })).entries.map((e) => e.key);

		test('count-desc (default) is most-cited first, ties by key', () => {
			assert.deepStrictEqual(order('count-desc'), ['b', 'a', 'c']);
		});
		test('count-asc is least-cited first', () => {
			assert.deepStrictEqual(order('count-asc'), ['c', 'a', 'b']);
		});
		test('author ascending/descending sorts by first author family name', () => {
			assert.deepStrictEqual(order('author-asc'), ['b', 'c', 'a']); // Adams < Mundy < Zeta
			assert.deepStrictEqual(order('author-desc'), ['a', 'c', 'b']);
		});
		test('title ascending sorts by title', () => {
			assert.deepStrictEqual(order('title-asc'), ['b', 'a', 'c']); // Alpha < Bravo < Charlie
		});
		test('year newest/oldest first', () => {
			assert.deepStrictEqual(order('year-desc'), ['b', 'a', 'c']); // 2010, 2000, 1990
			assert.deepStrictEqual(order('year-asc'), ['c', 'a', 'b']);
		});
		test('key ascending/descending', () => {
			assert.deepStrictEqual(order('key-asc'), ['a', 'b', 'c']);
			assert.deepStrictEqual(order('key-desc'), ['c', 'b', 'a']);
		});

		test('entries missing the sort field are pushed to the end', () => {
			const i = new CitationIndex();
			i.updateBibFile('/ws/refs.bib', [entry('withYear', { year: 2000 }), entry('noYear'), entry('withYear2', { year: 1990 })]);
			const keys = buildViewModel(i, state({ sort: 'year-asc' })).entries.map((e) => e.key);
			assert.deepStrictEqual(keys, ['withYear2', 'withYear', 'noYear']);
		});
	});

	suite('shape & counts', () => {
		test('reports visible vs total sources and carries occurrences on used entries', () => {
			const i = new CitationIndex();
			i.updateBibFile('/ws/refs.bib', [entry('a'), entry('b')]);
			i.updateTexFile('/ws/main.tex', [cite('a'), cite('a', 5)]);
			const m = buildViewModel(i, state({ filter: 'used' }));
			assert.strictEqual(m.totalSources, 2);
			assert.strictEqual(m.visibleSources, 1);
			assert.strictEqual(m.entries[0].occurrences.length, 2);
			assert.strictEqual(m.hasBibliography, true);
		});

		test('an empty index has no bibliography and no rows', () => {
			const m = buildViewModel(new CitationIndex(), state());
			assert.strictEqual(m.hasBibliography, false);
			assert.deepStrictEqual(m.entries, []);
			assert.deepStrictEqual(m.undefinedKeys, []);
		});
	});

	test('authorSortKey extracts the first author family name', () => {
		assert.strictEqual(authorSortKey('Knuth, Donald E.'), 'knuth');
		assert.strictEqual(authorSortKey('Donald E. Knuth'), 'knuth');
		assert.strictEqual(authorSortKey('Lamport, Leslie and Knuth, Donald'), 'lamport');
		assert.strictEqual(authorSortKey(undefined), '');
	});
});
