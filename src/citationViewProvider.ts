import * as vscode from 'vscode';
import type { CitationIndex } from './citationIndex.js';
import type { Citation } from './types.js';
import { buildViewModel, DEFAULT_STATE, type ViewState } from './viewModel.js';
import { copyCitationKey, goToBibDefinition, goToUsage } from './commands.js';

// Webview host for the Citations view.
//
// The heavy lifting (search / filter / sort) lives in the pure `viewModel`
// module; this class is the thin shell that owns the persisted UI state, renders
// the HTML, and shuttles messages between the webview and the extension.

const STATE_KEY = 'latex-citation-stats.viewState';

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
		webview.html = this.html(webview);

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
			.getConfiguration('latex-citation-stats')
			.get<boolean>('showOverview', true);
		void this.view.webview.postMessage({
			type: 'update',
			showOverview,
			state: this.state,
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

	/** Mirror the tree's old header summary and undefined-key badge on the view. */
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

	// ---- HTML -------------------------------------------------------------

	private html(webview: vscode.Webview): string {
		const nonce = makeNonce();
		const asset = (file: string): vscode.Uri =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource}`,
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link href="${asset('citationView.css')}" rel="stylesheet" />
	<title>LaTeX Citations</title>
</head>
<body>
	<div id="toolbar">
		<div class="search-row">
			<div class="search-box" id="searchBox">
				<input id="search" type="text" placeholder="Search citations" spellcheck="false"
					aria-label="Search citations" />
				<div class="toggles">
					<button id="tgCase" class="toggle" title="Match Case" aria-label="Match Case" aria-pressed="false">Aa</button>
					<button id="tgWord" class="toggle" title="Match Whole Word" aria-label="Match Whole Word" aria-pressed="false"><span class="word">ab</span></button>
					<button id="tgRegex" class="toggle" title="Use Regular Expression" aria-label="Use Regular Expression" aria-pressed="false">.*</button>
				</div>
			</div>
			<div class="menu-anchor">
				<button id="btnFilter" class="icon-button" title="Filter citations" aria-label="Filter citations" aria-haspopup="true" aria-expanded="false">${FILTER_ICON}</button>
				<div id="filterMenu" class="menu" role="menu" hidden></div>
			</div>
			<div class="menu-anchor">
				<button id="btnSort" class="icon-button" title="Sort citations" aria-label="Sort citations" aria-haspopup="true" aria-expanded="false">${SORT_ICON}</button>
				<div id="sortMenu" class="menu" role="menu" hidden></div>
			</div>
		</div>
		<div id="resultInfo" class="result-info" hidden></div>
	</div>
	<div id="content" tabindex="0"></div>
	<script nonce="${nonce}" src="${asset('citationView.js')}"></script>
</body>
</html>`;
	}
}

// Inline SVG so the toolbar needs no icon-font asset (keeps the bundle offline
// and dependency-free). Both use `currentColor` so they follow the theme.
const FILTER_ICON =
	'<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5L2 3z"/></svg>';
const SORT_ICON =
	'<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 2l3 3H5v9H3V5H1l3-3zm7 12l-3-3h2V2h2v9h2l-3 3z"/></svg>';

function makeNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

const VALID_FILTERS = new Set<ViewState['filter']>(['all', 'used', 'unused', 'undefined']);
const VALID_SORTS = new Set<ViewState['sort']>([
	'count-desc',
	'count-asc',
	'author-asc',
	'author-desc',
	'title-asc',
	'title-desc',
	'year-desc',
	'year-asc',
	'key-asc',
	'key-desc',
]);

/** Coerce an untrusted state object from the webview back to a known-good shape. */
function sanitizeState(state: ViewState): ViewState {
	return {
		query: typeof state.query === 'string' ? state.query : '',
		matchCase: Boolean(state.matchCase),
		matchWholeWord: Boolean(state.matchWholeWord),
		useRegex: Boolean(state.useRegex),
		filter: VALID_FILTERS.has(state.filter) ? state.filter : 'all',
		sort: VALID_SORTS.has(state.sort) ? state.sort : 'count-desc',
	};
}

function toPersisted(state: ViewState): PersistedState {
	const { query: _query, ...rest } = state;
	return rest;
}
