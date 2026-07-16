import * as vscode from 'vscode';
import { CitationManager } from './citationManager.js';
import type { CitationIndex } from './citationIndex.js';

/**
 * Public API returned from `activate()`. Other extensions — and the integration
 * tests — can read the live citation index through this handle.
 */
export interface CitationStatsApi {
	readonly index: CitationIndex;
}

// Thin activation entry point. All real work lives in CitationManager, which
// registers everything it owns on the extension context for automatic disposal.
export function activate(context: vscode.ExtensionContext): CitationStatsApi {
	const manager = new CitationManager(context);
	return { index: manager.index };
}

export function deactivate(): void {
	// Nothing to do: every disposable is registered on the extension context.
}
