import * as vscode from 'vscode';

// Static HTML shell for the Citations webview. The toolbar markup lives here; the
// list body and the filter/sort menus are rendered by media/citationView.js from
// the model and option list the provider posts in. Kept separate from the
// provider so the provider stays focused on state and messaging.

// Inline SVGs so the toolbar needs no icon-font asset (keeps the bundle offline
// and dependency-free). Both use `currentColor` so they follow the theme.
const FILTER_ICON =
	'<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5L2 3z"/></svg>';
const SORT_ICON =
	'<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 2l3 3H5v9H3V5H1l3-3zm7 12l-3-3h2V2h2v9h2l-3 3z"/></svg>';
// A bulleted, indented list — evokes the grouped / nested outline.
const GROUP_ICON =
	'<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 2.75a1 1 0 100 2 1 1 0 000-2zM6 3h8v1.5H6V3zm-4 4a1 1 0 100 2 1 1 0 000-2zm4 .25h8v1.5H6v-1.5zM2 11.25a1 1 0 100 2 1 1 0 000-2zm4 .25h8V13H6v-1.5z"/></svg>';

/** A cryptographically-unremarkable nonce; enough to satisfy the script CSP. */
function makeNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

/** Build the full HTML document for the Citations webview. */
export function citationViewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = makeNonce();
	const asset = (file: string): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
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
				<button id="btnGroup" class="icon-button" title="Group citations" aria-label="Group citations" aria-haspopup="true" aria-expanded="false">${GROUP_ICON}</button>
				<div id="groupMenu" class="menu" role="menu" hidden></div>
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
