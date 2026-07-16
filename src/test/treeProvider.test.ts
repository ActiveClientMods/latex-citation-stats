import * as assert from 'assert';
import * as vscode from 'vscode';
import { CitationIndex } from '../citationIndex.js';
import { CitationTreeProvider } from '../citationTreeProvider.js';
import { OPEN_CITATION_COMMAND } from '../commands.js';
import type { BibEntry, Citation } from '../types.js';

function entry(key: string, title?: string): BibEntry {
	return { key, entryType: 'article', title, filePath: '/ws/refs.bib', line: 0 };
}
function cite(key: string, line = 0, character = 0): Citation {
	return { key, command: 'cite', filePath: '/ws/main.tex', line, character, endCharacter: character + key.length, lineText: `\\cite{${key}}` };
}
const iconId = (item: vscode.TreeItem) => (item.iconPath as vscode.ThemeIcon).id;

suite('CitationTreeProvider (integration)', () => {
	test('roots list entries most-cited-first, appending an "Undefined citations" root only when needed', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('a'), entry('b')]);
		idx.updateTexFile('/ws/main.tex', [cite('b'), cite('b', 1)]);
		const provider = new CitationTreeProvider(idx);

		// All keys declared -> no undefined root; 'b' (2) sorts before 'a' (0).
		assert.deepStrictEqual(provider.getChildren().map((n) => provider.getTreeItem(n).label), ['b', 'a']);

		idx.updateTexFile('/ws/main.tex', [cite('b'), cite('ghost')]);
		const roots = provider.getChildren();
		const last = provider.getTreeItem(roots[roots.length - 1]);
		assert.strictEqual(last.label, 'Undefined citations');
		assert.strictEqual(iconId(last), 'error');
	});

	test('a used entry is collapsible with a count/title description and the references icon', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('withTitle', 'A Title'), entry('noTitle')]);
		idx.updateTexFile('/ws/main.tex', [cite('withTitle'), cite('withTitle', 1), cite('withTitle', 2), cite('noTitle')]);
		const provider = new CitationTreeProvider(idx);
		const [withTitle, noTitle] = provider.getChildren().map((n) => provider.getTreeItem(n));

		assert.strictEqual(withTitle.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
		assert.strictEqual(withTitle.description, '3× · A Title');
		assert.strictEqual(iconId(withTitle), 'references');
		assert.strictEqual(withTitle.contextValue, 'citationEntry');
		assert.strictEqual(noTitle.description, '1×'); // title suffix omitted when absent
	});

	test('an unused entry is non-collapsible with a warning icon and "unused" description', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('lonely', 'Nobody Cites Me')]);
		const provider = new CitationTreeProvider(idx);
		const item = provider.getTreeItem(provider.getChildren()[0]);

		assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.strictEqual(item.description, 'unused · Nobody Cites Me');
		assert.strictEqual(iconId(item), 'warning');
		assert.strictEqual(item.contextValue, 'citationEntryUnused');
	});

	test('entry children are citation leaves wired to the open command, with no further children', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('a')]);
		idx.updateTexFile('/ws/main.tex', [cite('a', 4, 6)]);
		const provider = new CitationTreeProvider(idx);

		const entryNode = provider.getChildren()[0];
		const [leafNode] = provider.getChildren(entryNode);
		const leaf = provider.getTreeItem(leafNode);

		assert.strictEqual(leaf.collapsibleState, vscode.TreeItemCollapsibleState.None);
		assert.ok((leaf.label as string).endsWith(':5'), 'label shows 1-based line number');
		assert.strictEqual(leaf.description, '\\cite{a}');
		assert.strictEqual(iconId(leaf), 'go-to-file');
		assert.strictEqual(leaf.command?.command, OPEN_CITATION_COMMAND);
		assert.strictEqual((leaf.command?.arguments?.[0] as Citation).key, 'a');
		assert.strictEqual(leaf.contextValue, 'citationInstance');
		assert.deepStrictEqual(provider.getChildren(leafNode), []); // leaves have no children
	});

	test('the undefined root expands to undefined keys, which expand to their citations', () => {
		const idx = new CitationIndex();
		idx.updateBibFile('/ws/refs.bib', [entry('a')]);
		idx.updateTexFile('/ws/main.tex', [cite('ghost'), cite('ghost', 2)]);
		const provider = new CitationTreeProvider(idx);

		const roots = provider.getChildren();
		const [keyNode] = provider.getChildren(roots[roots.length - 1]);
		const keyItem = provider.getTreeItem(keyNode);
		assert.strictEqual(keyItem.label, 'ghost');
		assert.strictEqual(keyItem.description, '2× · missing entry');
		assert.strictEqual(iconId(keyItem), 'question');
		assert.strictEqual(provider.getChildren(keyNode).length, 2);
	});

	test('refresh() fires onDidChangeTreeData', () => {
		const provider = new CitationTreeProvider(new CitationIndex());
		let fired = 0;
		provider.onDidChangeTreeData(() => fired++);
		provider.refresh();
		assert.strictEqual(fired, 1);
	});
});
