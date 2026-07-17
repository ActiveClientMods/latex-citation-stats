import * as vscode from 'vscode';
import type { Citation, SortOrder, TreeNode } from './types.js';
import type { CitationIndex } from './citationIndex.js';
import { GO_TO_BIB_DEFINITION_COMMAND, GO_TO_USAGE_COMMAND } from './commands.js';

// Tree structure:
//   stats           Overview -> statLine children (totals)
//   entry           a `.bib` key + its live count -> citation children
//                   (used entries expand; unused ones open their .bib entry)
//   undefinedRoot   shown only when dangling keys exist -> undefinedKey children
//   undefinedKey    a cited-but-undeclared key -> citation children (orphans)
//   citation        a single occurrence; leaf, opens the .tex on click

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
			case 'stats':
				return this.statsItem();
			case 'statLine':
				return this.statLineItem(node.label, node.value, node.icon);
			case 'entry':
				return this.entryItem(node);
			case 'undefinedRoot':
				return this.undefinedRootItem();
			case 'undefinedKey':
				return this.undefinedKeyItem(node.key);
			case 'citation':
				return this.citationItem(node.citation, node.orphan === true);
		}
	}

	getChildren(node?: TreeNode): TreeNode[] {
		if (!node) {
			return this.rootNodes();
		}
		switch (node.kind) {
			case 'stats':
				return this.statLines();
			case 'entry':
				return this.index.getCitations(node.key).map((citation) => ({ kind: 'citation', citation }));
			case 'undefinedKey':
				// Orphans have no .bib entry, so their menu omits "Go to Bib Definition".
				return this.index
					.getCitations(node.key)
					.map((citation) => ({ kind: 'citation', citation, orphan: true }));
			case 'undefinedRoot':
				return this.index.getUndefinedKeys().map((key) => ({ kind: 'undefinedKey', key }));
			case 'statLine':
			case 'citation':
				return [];
		}
	}

	private rootNodes(): TreeNode[] {
		const nodes: TreeNode[] = [];
		if (this.config().get<boolean>('showOverview', true) && this.index.hasBibliography()) {
			nodes.push({ kind: 'stats' });
		}
		for (const { entry } of this.index.getEntriesWithCounts(this.sortOrder())) {
			nodes.push({ kind: 'entry', key: entry.key });
		}
		if (this.index.getUndefinedKeys().length > 0) {
			nodes.push({ kind: 'undefinedRoot' });
		}
		return nodes;
	}

	private config(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('latex-citation-stats');
	}

	private sortOrder(): SortOrder {
		return this.config().get<SortOrder>('sortOrder', 'usage') === 'alphabetical' ? 'alphabetical' : 'usage';
	}

	// ---- TreeItem builders ------------------------------------------------

	private statsItem(): vscode.TreeItem {
		const s = this.index.getStats();
		const item = new vscode.TreeItem('Overview', vscode.TreeItemCollapsibleState.Collapsed);
		item.description = `${s.totalSources} sources · ${s.totalCitations} citations`;
		item.tooltip = new vscode.MarkdownString(
			[
				`**Citation overview**`,
				'',
				`- Sources: **${s.totalSources}**`,
				`- Used: **${s.usedSources}**`,
				`- Unused: **${s.unusedSources}**`,
				`- Citations: **${s.totalCitations}**`,
				...(s.undefinedKeys > 0 ? [`- Undefined keys: **${s.undefinedKeys}**`] : []),
			].join('\n'),
		);
		item.iconPath = new vscode.ThemeIcon('graph');
		item.contextValue = 'citationStats';
		return item;
	}

	private statLines(): TreeNode[] {
		const s = this.index.getStats();
		return [
			{ kind: 'statLine', label: 'Total sources', value: s.totalSources, icon: 'library' },
			{ kind: 'statLine', label: 'Used', value: s.usedSources, icon: 'check' },
			{ kind: 'statLine', label: 'Unused', value: s.unusedSources, icon: 'warning' },
			{ kind: 'statLine', label: 'Total citations', value: s.totalCitations, icon: 'references' },
		];
	}

	private statLineItem(label: string, value: number, icon: string): vscode.TreeItem {
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.description = String(value);
		item.iconPath = new vscode.ThemeIcon(icon);
		item.contextValue = 'citationStatLine';
		return item;
	}

	private entryItem(node: { key: string }): vscode.TreeItem {
		const key = node.key;
		const count = this.index.getCount(key);
		const used = count > 0;
		const item = new vscode.TreeItem(
			key,
			used ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
		);

		const title = this.index.getEntry(key)?.title;
		item.description = used ? `${count}×${title ? ` · ${title}` : ''}` : `unused${title ? ` · ${title}` : ''}`;
		item.tooltip = new vscode.MarkdownString(
			`**${key}**\n\n${used ? `Cited **${count}** time${count === 1 ? '' : 's'}` : '**Unused** — not cited anywhere'}` +
				(title ? `\n\n_${title}_` : ''),
		);
		item.iconPath = used
			? new vscode.ThemeIcon('references')
			: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
		item.contextValue = used ? 'citationEntry' : 'citationEntryUnused';

		// Used entries expand on click; unused ones have nothing to expand, so a
		// click jumps to their definition in the .bib file instead.
		if (!used) {
			item.command = {
				command: GO_TO_BIB_DEFINITION_COMMAND,
				title: 'Go to Bib Definition',
				arguments: [node],
			};
		}
		return item;
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
		item.tooltip = new vscode.MarkdownString(
			`**${key}**\n\nCited **${count}** time${count === 1 ? '' : 's'} but not declared in any \`.bib\` file.`,
		);
		item.iconPath = new vscode.ThemeIcon('question');
		item.contextValue = 'citationUndefinedKey';
		return item;
	}

	private citationItem(citation: Citation, orphan: boolean): vscode.TreeItem {
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
		item.contextValue = orphan ? 'citationInstanceOrphan' : 'citationInstance';
		// Clicking the node jumps straight to the exact line/column.
		item.command = {
			command: GO_TO_USAGE_COMMAND,
			title: 'Go to Usage',
			arguments: [{ kind: 'citation', citation, orphan } satisfies TreeNode],
		};
		return item;
	}
}
