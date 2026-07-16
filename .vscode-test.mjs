import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Open the fixtures folder as the workspace so `findFiles` and the file
	// watchers have real .bib/.tex files to index in the end-to-end test.
	workspaceFolder: './src/test/fixtures',
	mocha: {
		// The end-to-end test waits on debounced updates and initial scans.
		timeout: 20000,
	},
});
