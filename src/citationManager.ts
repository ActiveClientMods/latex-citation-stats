import * as vscode from 'vscode';
import { CitationIndex } from './citationIndex.js';
import { CitationTreeProvider } from './citationTreeProvider.js';
import { parseBib } from './parsers/bibParser.js';
import { parseTex } from './parsers/texParser.js';
import { KeyedDebouncer } from './util/debounce.js';
import type { TreeNode } from './types.js';
import {
	COPY_CITATION_KEY_COMMAND,
	GO_TO_BIB_DEFINITION_COMMAND,
	GO_TO_USAGE_COMMAND,
	REFRESH_COMMAND,
	copyCitationKey,
	goToBibDefinition,
	goToUsage,
} from './commands.js';

const VIEW_ID = 'latexCitationStats.view';
const BIB_GLOB = '**/*.bib';
const TEX_GLOB = '**/*.tex';
const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Owns the full lifecycle: builds the index, drives the tree, and keeps both in
 * sync with the workspace via file watchers and (debounced) live-edit events.
 * Everything it creates is registered on the extension context for disposal.
 */
export class CitationManager {
	/** The live citation cache. Exposed read-mostly for the extension API and tests. */
	readonly index = new CitationIndex();
	private readonly treeProvider: CitationTreeProvider;
	private readonly view: vscode.TreeView<TreeNode>;
	private readonly debouncer: KeyedDebouncer;
	// Coalesces many index updates into a single tree repaint per debounce tick.
	private refreshScheduled = false;

	constructor(context: vscode.ExtensionContext) {
		this.treeProvider = new CitationTreeProvider(this.index);
		this.debouncer = new KeyedDebouncer(this.debounceDelay());

		this.view = vscode.window.createTreeView<TreeNode>(VIEW_ID, {
			treeDataProvider: this.treeProvider,
			showCollapseAll: true,
		});

		context.subscriptions.push(
			this.view,
			{ dispose: () => this.debouncer.dispose() },
			vscode.commands.registerCommand(REFRESH_COMMAND, () => this.fullScan()),
			vscode.commands.registerCommand(GO_TO_USAGE_COMMAND, (node: TreeNode) => goToUsage(node)),
			vscode.commands.registerCommand(GO_TO_BIB_DEFINITION_COMMAND, (node: TreeNode) =>
				goToBibDefinition(node, this.index),
			),
			vscode.commands.registerCommand(COPY_CITATION_KEY_COMMAND, (node: TreeNode) => copyCitationKey(node)),
			...this.createWatchers(),
			this.createLiveEditListener(),
			this.createConfigListener(),
		);

		void this.fullScan();
	}

	private debounceDelay(): number {
		const configured = vscode.workspace
			.getConfiguration('latex-citation-stats')
			.get<number>('debounceDelay', DEFAULT_DEBOUNCE_MS);
		return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_DEBOUNCE_MS;
	}

	// ---- Initial / full scan ----------------------------------------------

	/**
	 * Scan the whole workspace once. This is the *only* path that reads every
	 * file; all subsequent updates are single-file deltas.
	 */
	private async fullScan(): Promise<void> {
		const [bibFiles, texFiles] = await Promise.all([
			vscode.workspace.findFiles(BIB_GLOB),
			vscode.workspace.findFiles(TEX_GLOB),
		]);

		await Promise.all([
			...bibFiles.map((uri) => this.reindexBib(uri)),
			...texFiles.map((uri) => this.reindexTex(uri)),
		]);

		this.refreshTree();
	}

	// ---- Watchers (disk changes: save / create / delete / external) -------

	private createWatchers(): vscode.Disposable[] {
		const bibWatcher = vscode.workspace.createFileSystemWatcher(BIB_GLOB);
		const texWatcher = vscode.workspace.createFileSystemWatcher(TEX_GLOB);

		bibWatcher.onDidCreate((uri) => this.onDiskChange(uri, 'bib'));
		bibWatcher.onDidChange((uri) => this.onDiskChange(uri, 'bib'));
		bibWatcher.onDidDelete((uri) => this.onDelete(uri, 'bib'));

		texWatcher.onDidCreate((uri) => this.onDiskChange(uri, 'tex'));
		texWatcher.onDidChange((uri) => this.onDiskChange(uri, 'tex'));
		texWatcher.onDidDelete((uri) => this.onDelete(uri, 'tex'));

		return [bibWatcher, texWatcher];
	}

	private async onDiskChange(uri: vscode.Uri, kind: 'bib' | 'tex'): Promise<void> {
		if (kind === 'bib') {
			await this.reindexBib(uri);
		} else {
			await this.reindexTex(uri);
		}
		this.scheduleRefresh();
	}

	private onDelete(uri: vscode.Uri, kind: 'bib' | 'tex'): void {
		this.debouncer.cancel(uri.fsPath);
		if (kind === 'bib') {
			this.index.removeBibFile(uri.fsPath);
		} else {
			this.index.removeTexFile(uri.fsPath);
		}
		this.scheduleRefresh();
	}

	// ---- Live edits (unsaved keystrokes) ----------------------------------

	private createLiveEditListener(): vscode.Disposable {
		return vscode.workspace.onDidChangeTextDocument((event) => {
			const doc = event.document;
			const kind = documentKind(doc);
			if (!kind || event.contentChanges.length === 0) {
				return;
			}
			// Debounce per file, then re-parse ONLY this document from its live
			// in-memory text — no disk read, no workspace rescan.
			this.debouncer.schedule(doc.uri.fsPath, () => {
				if (kind === 'bib') {
					this.index.updateBibFile(doc.uri.fsPath, parseBib(doc.getText(), doc.uri.fsPath));
				} else {
					this.index.updateTexFile(doc.uri.fsPath, parseTex(doc.getText(), doc.uri.fsPath));
				}
				this.refreshTree();
			});
		});
	}

	/** Re-render when the view's presentation settings change. */
	private createConfigListener(): vscode.Disposable {
		return vscode.workspace.onDidChangeConfiguration((event) => {
			if (
				event.affectsConfiguration('latex-citation-stats.sortOrder') ||
				event.affectsConfiguration('latex-citation-stats.showOverview')
			) {
				this.refreshTree();
			}
		});
	}

	// ---- Single-file reindex from disk ------------------------------------

	private async reindexBib(uri: vscode.Uri): Promise<void> {
		const text = await this.readText(uri);
		if (text !== undefined) {
			this.index.updateBibFile(uri.fsPath, parseBib(text, uri.fsPath));
		}
	}

	private async reindexTex(uri: vscode.Uri): Promise<void> {
		const text = await this.readText(uri);
		if (text !== undefined) {
			this.index.updateTexFile(uri.fsPath, parseTex(text, uri.fsPath));
		}
	}

	private async readText(uri: vscode.Uri): Promise<string | undefined> {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			return Buffer.from(bytes).toString('utf8');
		} catch {
			// File vanished between discovery and read; safe to ignore.
			return undefined;
		}
	}

	// ---- Refresh ----------------------------------------------------------

	/** Repaint the tree and refresh the view's header summary and badge. */
	private refreshTree(): void {
		this.treeProvider.refresh();
		this.updateViewChrome();
	}

	/**
	 * Surface the headline numbers without costing a tree row: the count of
	 * used sources sits next to the view title, and undefined keys — the only
	 * true error state — raise a badge on the activity bar icon.
	 */
	private updateViewChrome(): void {
		const stats = this.index.getStats();
		this.view.description =
			stats.totalSources === 0
				? undefined
				: `${stats.usedSources}/${stats.totalSources} used · ${stats.totalCitations} citations`;
		this.view.badge =
			stats.undefinedKeys > 0
				? {
						value: stats.undefinedKeys,
						tooltip: `${stats.undefinedKeys} undefined citation key${stats.undefinedKeys === 1 ? '' : 's'}`,
					}
				: undefined;
	}

	// Batch bursts of watcher events (e.g. a multi-file save) into one repaint
	// on the next microtask.
	private scheduleRefresh(): void {
		if (this.refreshScheduled) {
			return;
		}
		this.refreshScheduled = true;
		queueMicrotask(() => {
			this.refreshScheduled = false;
			this.refreshTree();
		});
	}
}

function documentKind(doc: vscode.TextDocument): 'bib' | 'tex' | undefined {
	if (doc.uri.scheme !== 'file') {
		return undefined;
	}
	if (doc.languageId === 'bibtex' || doc.fileName.endsWith('.bib')) {
		return 'bib';
	}
	if (doc.languageId === 'latex' || doc.fileName.endsWith('.tex')) {
		return 'tex';
	}
	return undefined;
}
