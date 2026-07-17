import * as assert from 'assert';
import * as vscode from 'vscode';
import { CitationIndex } from '../citationIndex.js';
import { CitationTreeProvider } from '../citationTreeProvider.js';
import { GO_TO_BIB_DEFINITION_COMMAND, GO_TO_USAGE_COMMAND } from '../commands.js';
import type { BibEntry, Citation, TreeNode } from '../types.js';

function entry(key: string, title?: string): BibEntry {
	return { key, entryType: 'article', title, filePath: '/ws/refs.bib', line: 0, character: 0, endCharacter: key.length };
}
function cite(key: string, line = 0, character = 0): Citation {
	return { key, command: 'cite', filePath: '/ws/main.tex', line, character, endCharacter: character + key.length, lineText: `\\cite{${key}}` };
}
const iconId = (item: vscode.TreeItem) => (item.iconPath as vscode.ThemeIcon).id;

/** Root nodes minus the Overview node, which is asserted separately. */
function sourceRoots(provider: CitationTreeProvider): TreeNode[] {
	return provider.getChildren().filter((n) => n.kind !== 'stats');
}

suite('CitationTreeProvider (integration)', () => {
	test('roots list entries most-cited-first, appending an "Undefined citations" root only when needed', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('a'), entry('b')]);
		idx.updateTexFile('/ws/main.tex', [cite('b'), cite('b', 1)]);
		const provider = new CitationTreeProvider(idx);

		// All keys declared -> no undefined root; 'b' (2) sorts before 'a' (0).
		assert.deepStrictEqual(sourceRoots(provider).map((n) => provider.getTreeItem(n).label), ['b', 'a']);

		idx.updateTexFile('/ws/main.tex', [cite('b'), cite('ghost')]);
		const roots = sourceRoots(provider);
		const last = provider.getTreeItem(roots[roots.length - 1]);
		assert.strictEqual(last.label, 'Undefined citations');
		assert.strictEqual(iconId(last), 'error');
	});

	test('a used entry is collapsible with a count/title description and the references icon', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('withTitle', 'A Title'), entry('noTitle')]);
		idx.updateTexFile('/ws/main.tex', [cite('withTitle'), cite('withTitle', 1), cite('withTitle', 2), cite('noTitle')]);
		const provider = new CitationTreeProvider(idx);
		const [withTitle, noTitle] = sourceRoots(provider).map((n) => provider.getTreeItem(n));

		assert.strictEqual(withTitle.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
		assert.strictEqual(withTitle.description, '3× · A Title');
		assert.strictEqual(iconId(withTitle), 'references');
		assert.strictEqual(withTitle.contextValue, 'citationEntry');
		assert.strictEqual(withTitle.command, undefined, 'used entries expand on click rather than navigating');
		assert.strictEqual(noTitle.description, '1×'); // title suffix omitted when absent
	});

	test('an unused entry has a warning icon and click-navigates to its .bib definition', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('lonely', 'Nobody Cites Me')]);
		const provider = new CitationTreeProvider(idx);
		const node = sourceRoots(provider)[0];
		const item = provider.getTreeItem(node);

		assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.strictEqual(item.description, 'unused · Nobody Cites Me');
		assert.strictEqual(iconId(item), 'warning');
		assert.strictEqual(item.contextValue, 'citationEntryUnused');
		// Left-click opens the .bib entry.
		assert.strictEqual(item.command?.command, GO_TO_BIB_DEFINITION_COMMAND);
		assert.deepStrictEqual(item.command?.arguments?.[0], node);
	});

	test('entry children are citation leaves wired to Go to Usage, with no further children', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('a')]);
		idx.updateTexFile('/ws/main.tex', [cite('a', 4, 6)]);
		const provider = new CitationTreeProvider(idx);

		const entryNode = sourceRoots(provider)[0];
		const [leafNode] = provider.getChildren(entryNode);
		const leaf = provider.getTreeItem(leafNode);

		assert.strictEqual(leaf.collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.ok((leaf.label as string).endsWith(':5'), 'label shows 1-based line number');
		assert.strictEqual(leaf.description, '\\cite{a}');
		assert.strictEqual(iconId(leaf), 'go-to-file');
		assert.strictEqual(leaf.command?.command, GO_TO_USAGE_COMMAND);
		assert.strictEqual((leaf.command?.arguments?.[0] as { citation: Citation }).citation.key, 'a');
		assert.strictEqual(leaf.contextValue, 'citationInstance');
		assert.deepStrictEqual(provider.getChildren(leafNode), []); // leaves have no children
	});

	test('the undefined root expands to undefined keys, whose citations are marked as orphans', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('a')]);
		idx.updateTexFile('/ws/main.tex', [cite('ghost'), cite('ghost', 2)]);
		const provider = new CitationTreeProvider(idx);

		const roots = sourceRoots(provider);
		const [keyNode] = provider.getChildren(roots[roots.length - 1]);
		const keyItem = provider.getTreeItem(keyNode);
		assert.strictEqual(keyItem.label, 'ghost');
		assert.strictEqual(keyItem.description, '2× · missing entry');
		assert.strictEqual(iconId(keyItem), 'question');

		// Orphan instances get their own context value so the menu can omit
		// "Go to Bib Definition" (there is no definition to go to).
		const orphans = provider.getChildren(keyNode);
		assert.strictEqual(orphans.length, 2);
		assert.strictEqual(provider.getTreeItem(orphans[0]).contextValue, 'citationInstanceOrphan');
	});

	suite('overview node', () => {
		test('is the first root and summarises the index, expanding to detail lines', () => {
			const idx = new CitationIndex();
			idx.updateBibFile('/ws/refs.bib', [entry('a'), entry('b'), entry('unused')]);
			idx.updateTexFile('/ws/main.tex', [cite('a'), cite('a', 1), cite('b', 2)]);
			const provider = new CitationTreeProvider(idx);

			const [first] = provider.getChildren();
			assert.strictEqual(first.kind, 'stats');
			const item = provider.getTreeItem(first);
			assert.strictEqual(item.label, 'Overview');
			assert.strictEqual(item.description, '3 sources · 3 citations');
			assert.strictEqual(iconId(item), 'graph');

			assert.deepStrictEqual(
				provider.getChildren(first).map((n) => {
					const line = provider.getTreeItem(n);
					return [line.label, line.description];
				}),
				[
					['Total sources', '3'],
					['Used', '2'],
					['Unused', '1'],
					['Total citations', '3'],
				],
			);
		});

		test('is omitted when no .bib file has been indexed', () => {
			const provider = new CitationTreeProvider(new CitationIndex());
			assert.deepStrictEqual(provider.getChildren(), []);
		});
	});

	test('refresh() fires onDidChangeTreeData', () => {
		const provider = new CitationTreeProvider(new CitationIndex());
		let fired = 0;
		provider.onDidChangeTreeData(() => fired++);
		provider.refresh();
		assert.strictEqual(fired, 1);
	});
});
