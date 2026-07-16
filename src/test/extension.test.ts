import * as assert from 'assert';
import * as vscode from 'vscode';
import { REFRESH_COMMAND, OPEN_CITATION_COMMAND } from '../commands.js';

/**
 * Smoke-test that the extension actually activates and wires up its
 * contributions inside a real VS Code instance.
 */
suite('Extension activation (integration)', () => {
	// The dev extension is loaded under its package.json name; publisher is
	// unset in the manifest, so find it by name rather than by a fixed id.
	function findExtension(): vscode.Extension<unknown> | undefined {
		return vscode.extensions.all.find((e) => e.packageJSON?.name === 'latex-citation-stats');
	}

	test('the extension is present and activates without error', async () => {
		const ext = findExtension();
		assert.ok(ext, 'extension should be discoverable in the test host');
		await ext.activate();
		assert.strictEqual(ext.isActive, true);
	});

	test('registers its commands on activation', async () => {
		await findExtension()?.activate();
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes(REFRESH_COMMAND), 'refresh command should be registered');
		assert.ok(commands.includes(OPEN_CITATION_COMMAND), 'openCitation command should be registered');
	});

	test('activating twice is safe (idempotent)', async () => {
		const ext = findExtension();
		await ext?.activate();
		await assert.doesNotReject(async () => {
			await ext?.activate();
		});
	});
});
