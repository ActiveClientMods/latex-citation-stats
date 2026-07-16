import * as assert from 'assert';
import * as vscode from 'vscode';
import type { CitationStatsApi } from '../extension.js';

/**
 * End-to-end test of the whole CitationManager pipeline against a real workspace
 * (src/test/fixtures, opened via .vscode-test.mjs `workspaceFolder`):
 *   findFiles -> parse -> index -> debounced live edits -> delta merge.
 *
 * Edits are applied in-memory only (never saved), so the committed fixture
 * files on disk are left untouched.
 */
suite('CitationManager end-to-end (real workspace)', () => {
	let api: CitationStatsApi;
	let mainTex: vscode.Uri;

	/** Poll until `predicate` holds or the timeout elapses. */
	async function waitFor(predicate: () => boolean, timeoutMs = 10000, stepMs = 25): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (predicate()) {
				return;
			}
			await new Promise((r) => setTimeout(r, stepMs));
		}
		assert.fail(`condition not met within ${timeoutMs}ms`);
	}

	suiteSetup(async () => {
		const ext = vscode.extensions.all.find((e) => e.packageJSON?.name === 'latex-citation-stats');
		assert.ok(ext, 'extension should be discoverable');
		api = (await ext.activate()) as CitationStatsApi;

		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, 'fixtures workspace folder should be open');
		mainTex = vscode.Uri.joinPath(folder.uri, 'main.tex');
	});

	suiteTeardown(async () => {
		// Discard the in-memory edits without touching disk.
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('initial workspace scan indexes .bib entries and counts citations from .tex', async () => {
		// main.tex cites knuth1984 twice (\textcite + \cite) and lamport1994 once;
		// its \cite{unused2000} is inside a comment and must NOT be counted.
		await waitFor(() => api.index.getCount('knuth1984') === 2 && api.index.getCount('lamport1994') === 1);

		assert.strictEqual(api.index.getCount('unused2000'), 0, 'commented citation must be ignored');
		assert.deepStrictEqual(api.index.getUndefinedKeys(), [], 'every cited key is declared');

		const keys = api.index.getEntriesWithCounts().map((e) => e.entry.key);
		assert.ok(keys.includes('unused2000'), 'declared-but-unused entry should still appear');
	});

	test('live (unsaved) edits flow through debounce into the index as a delta', async () => {
		const doc = await vscode.workspace.openTextDocument(mainTex);
		await vscode.window.showTextDocument(doc);

		// Add a real use of the previously-unused key and cite a brand-new,
		// undeclared key — in-memory only.
		const edit = new vscode.WorkspaceEdit();
		edit.insert(mainTex, new vscode.Position(0, 0), '\\cite{unused2000}\\cite{brandNewKey}\n');
		assert.ok(await vscode.workspace.applyEdit(edit), 'edit should apply');

		// Debounced re-parse of just this document updates the global state.
		await waitFor(() => api.index.getCount('unused2000') === 1 && api.index.getUndefinedKeys().includes('brandNewKey'));

		// The originally-counted citations are unchanged by the single-file delta.
		assert.strictEqual(api.index.getCount('knuth1984'), 2);
		assert.strictEqual(api.index.getCount('lamport1994'), 1);
	});
});
