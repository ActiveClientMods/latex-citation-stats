import * as vscode from 'vscode';
import type { Citation } from './types.js';
import type { CitationIndex } from './citationIndex.js';
import { OPEN_CITATION_COMMAND } from './commands.js';

// Tree structure:
//   entry           (a `.bib` key + its live count)   -> citation children
//   undefinedRoot   (only shown when dangling keys exist) -> undefinedKey children
//   undefinedKey    (a cited-but-undeclared key)       -> citation children
//   citation        (a single `\cite` instance; leaf, opens on click)

type TreeNode =
	| { readonly kind: 'entry'; readonly key: string }
	| { readonly kind: 'undefinedRoot' }
	| { readonly kind: 'undefinedKey'; readonly key: string }
	| { readonly kind: 'citation'; readonly citation: Citation };

export class CitationTreeProvider implements vscode.TreeDataProvider<TreeNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly index: CitationIndex) {}

	/** Repaint the tree. Called (debounced) after the index changes. */
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(node: TreeNode): vscode.TreeItem {
		switch (node.kind) {
			case 'entry':
				return this.entryItem(node.key);
			case 'undefinedRoot':
				return this.undefinedRootItem();
			case 'undefinedKey':
				return this.undefinedKeyItem(node.key);
			case 'citation':
				return this.citationItem(node.citation);
		}
	}

	getChildren(node?: TreeNode): TreeNode[] {
		if (!node) {
			return this.rootNodes();
		}
		switch (node.kind) {
			case 'entry':
			case 'undefinedKey':
				return this.index.getCitations(node.key).map((citation) => ({ kind: 'citation', citation }));
			case 'undefinedRoot':
				return this.index.getUndefinedKeys().map((key) => ({ kind: 'undefinedKey', key }));
			case 'citation':
				return [];
		}
	}

	private rootNodes(): TreeNode[] {
		const nodes: TreeNode[] = this.index
			.getEntriesWithCounts()
			.map(({ entry }) => ({ kind: 'entry', key: entry.key }) as const);

		if (this.index.getUndefinedKeys().length > 0) {
			nodes.push({ kind: 'undefinedRoot' });
		}
		return nodes;
	}

	// ---- TreeItem builders ------------------------------------------------

	private entryItem(key: string): vscode.TreeItem {
		const count = this.index.getCount(key);
		const used = count > 0;
		const item = new vscode.TreeItem(
			key,
			used ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
		);

		const title = this.entryTitle(key);
		item.description = used ? `${count}×${title ? ` · ${title}` : ''}` : `unused${title ? ` · ${title}` : ''}`;
		item.tooltip = new vscode.MarkdownString(
			`**${key}**\n\n${used ? `Cited **${count}** time${count === 1 ? '' : 's'}` : '**Unused** — not cited anywhere'}` +
				(title ? `\n\n_${title}_` : ''),
		);
		item.iconPath = used
			? new vscode.ThemeIcon('references')
			: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
		item.contextValue = used ? 'citationEntry' : 'citationEntryUnused';
		return item;
	}

	private entryTitle(key: string): string | undefined {
		return this.index.getEntriesWithCounts().find((e) => e.entry.key === key)?.entry.title;
	}

	private undefinedRootItem(): vscode.TreeItem {
		const count = this.index.getUndefinedKeys().length;
		const item = new vscode.TreeItem('Undefined citations', vscode.TreeItemCollapsibleState.Collapsed);
		item.description = `${count} key${count === 1 ? '' : 's'} not in any .bib`;
		item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
		item.contextValue = 'citationUndefinedRoot';
		return item;
	}

	private undefinedKeyItem(key: string): vscode.TreeItem {
		const count = this.index.getCount(key);
		const item = new vscode.TreeItem(key, vscode.TreeItemCollapsibleState.Collapsed);
		item.description = `${count}× · missing entry`;
		item.iconPath = new vscode.ThemeIcon('question');
		item.contextValue = 'citationUndefinedKey';
		return item;
	}

	private citationItem(citation: Citation): vscode.TreeItem {
		const item = new vscode.TreeItem(
			`${vscode.workspace.asRelativePath(citation.filePath)}:${citation.line + 1}`,
			vscode.TreeItemCollapsibleState.None,
		);
		item.description = citation.lineText;
		item.tooltip = new vscode.MarkdownString(
			`\`\\${citation.command}\` in **${vscode.workspace.asRelativePath(citation.filePath)}**` +
				`\n\nLine ${citation.line + 1}, column ${citation.character + 1}`,
		);
		item.iconPath = new vscode.ThemeIcon('go-to-file');
		item.contextValue = 'citationInstance';
		// Clicking the node jumps straight to the exact line/column.
		item.command = {
			command: OPEN_CITATION_COMMAND,
			title: 'Open Citation',
			arguments: [citation],
		};
		return item;
	}
}
