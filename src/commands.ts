import * as vscode from 'vscode';
import type { Citation } from './types.js';

// Command IDs are defined once here and reused by both the tree provider and
// the package.json contributions, so they never drift out of sync.
export const OPEN_CITATION_COMMAND = 'latex-citation-stats.openCitation';
export const REFRESH_COMMAND = 'latex-citation-stats.refresh';

/**
 * Open the `.tex` file for a citation and place the cursor exactly on the key,
 * selecting it and scrolling it into view.
 */
export async function openCitation(citation: Citation): Promise<void> {
	const uri = vscode.Uri.file(citation.filePath);
	const selection = new vscode.Range(
		new vscode.Position(citation.line, citation.character),
		new vscode.Position(citation.line, citation.endCharacter),
	);
	await vscode.window.showTextDocument(uri, {
		selection,
		viewColumn: vscode.ViewColumn.Active,
		preserveFocus: false,
	});
}
