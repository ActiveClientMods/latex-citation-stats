import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { openCitation } from '../commands.js';
import type { Citation } from '../types.js';

suite('openCitation command (integration)', () => {
	let file: string;

	suiteSetup(async () => {
		file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'lcs-')), 'doc.tex');
		await fs.writeFile(
			file,
			['\\documentclass{article}', '\\begin{document}', 'Text \\cite{myKey} more text.', '\\end{document}'].join('\n'),
			'utf8',
		);
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		// Best-effort temp cleanup: Windows may briefly hold a lock on the file
		// after the editor closes. Failing to delete a temp dir must not fail the
		// suite — the OS reclaims os.tmpdir() anyway.
		try {
			await fs.rm(path.dirname(file), { recursive: true, force: true });
		} catch {
			/* ignore transient EBUSY on Windows */
		}
	});

	test('opens the target file and selects the exact key range', async () => {
		// "Text \cite{myKey}" -> key 'myKey' starts at column 11 on line 2 (0-based).
		const citation: Citation = {
			key: 'myKey',
			command: 'cite',
			filePath: file,
			line: 2,
			character: 11,
			endCharacter: 16,
			lineText: 'Text \\cite{myKey} more text.',
		};

		await openCitation(citation);

		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, 'an editor should be active');
		// VS Code lower-cases the Windows drive letter in fsPath; compare case-insensitively.
		assert.strictEqual(editor.document.uri.fsPath.toLowerCase(), file.toLowerCase());

		const sel = editor.selection;
		assert.strictEqual(sel.start.line, 2);
		assert.strictEqual(sel.start.character, 11);
		assert.strictEqual(sel.end.character, 16);
		assert.strictEqual(editor.document.getText(sel), 'myKey', 'the key itself should be selected');
	});
});
