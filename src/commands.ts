import * as vscode from 'vscode';
import type { CitationNode } from './model/types.js';
import type { CitationIndex } from './model/citationIndex.js';

// Command IDs are defined once here and reused by the view provider, the
// manager, and the package.json contributions, so they never drift out of sync.
export const GO_TO_USAGE_COMMAND = 'latex-citation-statistics.goToUsage';
export const GO_TO_BIB_DEFINITION_COMMAND = 'latex-citation-statistics.goToBibDefinition';
export const COPY_CITATION_KEY_COMMAND = 'latex-citation-statistics.copyCitationKey';
export const REFRESH_COMMAND = 'latex-citation-statistics.refresh';

// Handlers take a CitationNode: the webview posts these node-shaped payloads when
// a row is clicked or a row action is invoked, so one handler serves every row.

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
export async function goToUsage(node: CitationNode): Promise<void> {
	if (node?.kind !== 'citation') {
		return;
	}
	const { filePath, line, character, endCharacter } = node.citation;
	await openLocation(filePath, line, character, endCharacter);
}

/** Jump to where a key is defined in its `.bib` file. */
export async function goToBibDefinition(node: CitationNode, index: CitationIndex): Promise<void> {
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
export async function copyCitationKey(node: CitationNode): Promise<void> {
	const key = citationKeyOf(node);
	if (!key) {
		return;
	}
	await vscode.env.clipboard.writeText(key);
	vscode.window.setStatusBarMessage(`Copied citation key "${key}"`, 3000);
}

/** The citation key a node refers to, if it refers to one at all. */
export function citationKeyOf(node: CitationNode): string | undefined {
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
