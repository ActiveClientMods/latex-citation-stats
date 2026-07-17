import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { citationKeyOf, copyCitationKey, goToBibDefinition, goToUsage } from '../commands.js';
import { CitationIndex } from '../citationIndex.js';
import type { BibEntry, Citation, TreeNode } from '../types.js';

suite('commands (integration)', () => {
	let dir: string;
	let texFile: string;
	let bibFile: string;
	let index: CitationIndex;

	const citation = (): Citation => ({
		key: 'myKey',
		command: 'cite',
		filePath: texFile,
		line: 2,
		character: 11,
		endCharacter: 16,
		lineText: 'Text \\cite{myKey} more text.',
	});

	const bibEntry = (): BibEntry => ({
		key: 'myKey',
		entryType: 'article',
		filePath: bibFile,
		line: 1,
		character: 9,
		endCharacter: 14,
	});

	suiteSetup(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcs-'));
		texFile = path.join(dir, 'doc.tex');
		bibFile = path.join(dir, 'refs.bib');

		await fs.writeFile(
			texFile,
			['\\documentclass{article}', '\\begin{document}', 'Text \\cite{myKey} more text.', '\\end{document}'].join('\n'),
			'utf8',
		);
		// Line 1 is "@article{myKey," -> '{' at index 8, so the key starts at column 9.
		await fs.writeFile(bibFile, ['% refs', '@article{myKey,', '  title = {A Title}', '}'].join('\n'), 'utf8');

		index = new CitationIndex();
		index.updateBibFile(bibFile, [bibEntry()]);
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		// Best-effort temp cleanup: Windows may briefly hold a lock on the file
		// after the editor closes. Failing to delete a temp dir must not fail the
		// suite — the OS reclaims os.tmpdir() anyway.
		try {
			await fs.rm(dir, { recursive: true, force: true });
		} catch {
			/* ignore transient EBUSY on Windows */
		}
	});

	suite('goToUsage', () => {
		test('opens the .tex file and selects the exact key range', async () => {
			await goToUsage({ kind: 'citation', citation: citation() });

			const editor = vscode.window.activeTextEditor;
			assert.ok(editor, 'an editor should be active');
			// VS Code lower-cases the Windows drive letter in fsPath; compare case-insensitively.
			assert.strictEqual(editor.document.uri.fsPath.toLowerCase(), texFile.toLowerCase());
			assert.strictEqual(editor.selection.start.line, 2);
			assert.strictEqual(editor.document.getText(editor.selection), 'myKey');
		});

		test('ignores nodes that are not citations', async () => {
			await assert.doesNotReject(() => goToUsage({ kind: 'entry', key: 'myKey' }));
		});
	});

	suite('goToBibDefinition', () => {
		test('opens the .bib file and selects the key at its definition', async () => {
			await goToBibDefinition({ kind: 'entry', key: 'myKey' }, index);

			const editor = vscode.window.activeTextEditor;
			assert.ok(editor, 'an editor should be active');
			assert.strictEqual(editor.document.uri.fsPath.toLowerCase(), bibFile.toLowerCase());
			assert.strictEqual(editor.selection.start.line, 1);
			assert.strictEqual(editor.document.getText(editor.selection), 'myKey');
		});

		test('resolves the definition from a citation node too', async () => {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await goToBibDefinition({ kind: 'citation', citation: citation() }, index);
			assert.strictEqual(
				vscode.window.activeTextEditor?.document.uri.fsPath.toLowerCase(),
				bibFile.toLowerCase(),
			);
		});

		test('warns instead of throwing when the key has no .bib entry', async () => {
			await assert.doesNotReject(() => goToBibDefinition({ kind: 'undefinedKey', key: 'ghost' }, index));
		});
	});

	suite('copyCitationKey', () => {
		test('copies the key from entry, citation, and undefined-key nodes', async () => {
			const nodes: TreeNode[] = [
				{ kind: 'entry', key: 'fromEntry' },
				{ kind: 'citation', citation: { ...citation(), key: 'fromCitation' } },
				{ kind: 'undefinedKey', key: 'fromUndefined' },
			];
			for (const node of nodes) {
				await vscode.env.clipboard.writeText('');
				await copyCitationKey(node);
				assert.strictEqual(await vscode.env.clipboard.readText(), citationKeyOf(node));
			}
		});

		test('does nothing for nodes without a key', async () => {
			await vscode.env.clipboard.writeText('untouched');
			await copyCitationKey({ kind: 'stats' });
			assert.strictEqual(await vscode.env.clipboard.readText(), 'untouched');
		});
	});

	test('citationKeyOf resolves keys per node kind', () => {
		assert.strictEqual(citationKeyOf({ kind: 'entry', key: 'k' }), 'k');
		assert.strictEqual(citationKeyOf({ kind: 'undefinedKey', key: 'u' }), 'u');
		assert.strictEqual(citationKeyOf({ kind: 'citation', citation: citation() }), 'myKey');
		assert.strictEqual(citationKeyOf({ kind: 'undefinedRoot' }), undefined);
	});
});
