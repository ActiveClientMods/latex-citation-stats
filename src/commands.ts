import * as vscode from 'vscode';
import type { TreeNode } from './types.js';
import type { CitationIndex } from './citationIndex.js';

// Command IDs are defined once here and reused by the tree provider, the
// manager, and the package.json contributions, so they never drift out of sync.
export const GO_TO_USAGE_COMMAND = 'latex-citation-stats.goToUsage';
export const GO_TO_BIB_DEFINITION_COMMAND = 'latex-citation-stats.goToBibDefinition';
export const COPY_CITATION_KEY_COMMAND = 'latex-citation-stats.copyCitationKey';
export const REFRESH_COMMAND = 'latex-citation-stats.refresh';

// Handlers take a TreeNode: VS Code passes the tree element as the argument to
// `view/item/context` commands, and the tree's own click commands pass the same
// shape, so one handler serves both entry points.

/** Open a file and select the given range, scrolling it into view. */
export async function openLocation(
	filePath: string,
	line: number,
	character: number,
	endCharacter: number,
): Promise<void> {
	const selection = new vscode.Range(
		new vscode.Position(line, character),
		new vscode.Position(line, endCharacter),
	);
	await vscode.window.showTextDocument(vscode.Uri.file(filePath), {
		selection,
		viewColumn: vscode.ViewColumn.Active,
		preserveFocus: false,
	});
}

/** Jump to a citation occurrence in its `.tex` file. */
export async function goToUsage(node: TreeNode): Promise<void> {
	if (node?.kind !== 'citation') {
		return;
	}
	const { filePath, line, character, endCharacter } = node.citation;
	await openLocation(filePath, line, character, endCharacter);
}

/** Jump to where a key is defined in its `.bib` file. */
export async function goToBibDefinition(node: TreeNode, index: CitationIndex): Promise<void> {
	const key = citationKeyOf(node);
	if (!key) {
		return;
	}
	const entry = index.getEntry(key);
	if (!entry) {
		void vscode.window.showWarningMessage(`No .bib entry found for "${key}".`);
		return;
	}
	await openLocation(entry.filePath, entry.line, entry.character, entry.endCharacter);
}

/** Copy a node's citation key to the clipboard. */
export async function copyCitationKey(node: TreeNode): Promise<void> {
	const key = citationKeyOf(node);
	if (!key) {
		return;
	}
	await vscode.env.clipboard.writeText(key);
	vscode.window.setStatusBarMessage(`Copied citation key "${key}"`, 3000);
}

/** The citation key a node refers to, if it refers to one at all. */
export function citationKeyOf(node: TreeNode): string | undefined {
	switch (node?.kind) {
		case 'entry':
		case 'undefinedKey':
			return node.key;
		case 'citation':
			return node.citation.key;
		default:
			return undefined;
	}
}
