import * as vscode from 'vscode';
import type { CitationIndex } from '../model/citationIndex.js';
import type { Citation } from '../model/types.js';
import { buildViewModel, DEFAULT_STATE, type ViewState } from '../model/viewModel.js';
import { FILTER_OPTIONS, SORT_OPTIONS, isFilterMode, isSortKey } from '../model/viewOptions.js';
import { copyCitationKey, goToBibDefinition, goToUsage } from '../commands.js';
import { citationViewHtml } from './webviewContent.js';

// Webview host for the Citations view.
//
// The heavy lifting (search / filter / sort) lives in the pure `viewModel`
// module; this class is the thin shell that owns the persisted UI state, renders
// the HTML, and shuttles messages between the webview and the extension.

const STATE_KEY = 'latex-citation-statistics.viewState';

/** Persisted slice of the UI state — everything except the transient query. */
type PersistedState = Omit<ViewState, 'query'>;

/** A citation flattened for the webview, with a display-ready relative path. */
interface WireCitation extends Citation {
	relPath: string;
	displayLine: number;
}

/** Messages sent from the webview back to the extension. */
type InboundMessage =
	| { type: 'ready' }
	| { type: 'state'; state: ViewState }
	| { type: 'goToUsage'; citation: Citation }
	| { type: 'goToBibDefinition'; key: string }
	| { type: 'copyKey'; key: string };

export class CitationViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private state: ViewState;

	constructor(
		private readonly index: CitationIndex,
		private readonly context: vscode.ExtensionContext,
	) {
		const persisted = context.globalState.get<PersistedState>(STATE_KEY);
		this.state = { ...DEFAULT_STATE, ...persisted, query: '' };
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		const webview = webviewView.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};
		webview.html = citationViewHtml(webview, this.context.extensionUri);

		webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});

		webview.onDidReceiveMessage((message: InboundMessage) => this.onMessage(message));
	}

	/** Recompute and push a fresh model to the webview, and refresh the view chrome. */
	refresh(): void {
		this.post();
		this.updateChrome();
	}

	// ---- Messaging --------------------------------------------------------

	private onMessage(message: InboundMessage): void {
		switch (message.type) {
			case 'ready':
				// First paint after the view resolves: send the model and set the
				// header summary + badge, which were skipped while the view did not
				// yet exist during activation's initial scan.
				this.refresh();
				break;
			case 'state':
				this.state = sanitizeState(message.state);
				void this.context.globalState.update(STATE_KEY, toPersisted(this.state));
				this.post();
				break;
			case 'goToUsage':
				void goToUsage({ kind: 'citation', citation: message.citation });
				break;
			case 'goToBibDefinition':
				void goToBibDefinition({ kind: 'entry', key: message.key }, this.index);
				break;
			case 'copyKey':
				void copyCitationKey({ kind: 'entry', key: message.key });
				break;
		}
	}

	private post(): void {
		if (!this.view) {
			return;
		}
		const model = buildViewModel(this.index, this.state);
		const showOverview = vscode.workspace
			.getConfiguration('latex-citation-statistics')
			.get<boolean>('showOverview', true);
		void this.view.webview.postMessage({
			type: 'update',
			showOverview,
			state: this.state,
			// The menu labels live in one place (viewOptions); the webview renders
			// them, so the menus can never drift from the ids the model acts on.
			options: { filters: FILTER_OPTIONS, sorts: SORT_OPTIONS },
			model: {
				hasBibliography: model.hasBibliography,
				filtering: model.filtering,
				regexError: model.regexError,
				visibleSources: model.visibleSources,
				totalSources: model.totalSources,
				stats: model.stats,
				entries: model.entries.map((e) => ({
					key: e.key,
					title: e.title,
					author: e.author,
					year: e.year,
					count: e.count,
					used: e.used,
					occurrences: e.occurrences.map((c) => this.toWire(c)),
				})),
				undefinedKeys: model.undefinedKeys.map((u) => ({
					key: u.key,
					count: u.count,
					occurrences: u.occurrences.map((c) => this.toWire(c)),
				})),
			},
		});
	}

	private toWire(citation: Citation): WireCitation {
		return {
			...citation,
			relPath: vscode.workspace.asRelativePath(citation.filePath),
			displayLine: citation.line + 1,
		};
	}

	/** Surface the header summary and undefined-key badge on the view. */
	private updateChrome(): void {
		if (!this.view) {
			return;
		}
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

}

/** Coerce an untrusted state object from the webview back to a known-good shape. */
function sanitizeState(state: ViewState): ViewState {
	return {
		query: typeof state.query === 'string' ? state.query : '',
		matchCase: Boolean(state.matchCase),
		matchWholeWord: Boolean(state.matchWholeWord),
		useRegex: Boolean(state.useRegex),
		filter: isFilterMode(state.filter) ? state.filter : DEFAULT_STATE.filter,
		sort: isSortKey(state.sort) ? state.sort : DEFAULT_STATE.sort,
	};
}

function toPersisted(state: ViewState): PersistedState {
	const { query: _query, ...rest } = state;
	return rest;
}
