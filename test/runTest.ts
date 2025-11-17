import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		// Some developer setups export ELECTRON_RUN_AS_NODE to drive the VS Code CLI.
		// The integration harness needs the normal Electron host, so strip those env overrides.
		delete process.env.ELECTRON_RUN_AS_NODE;
		delete process.env.VSCODE_DEV;

		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Download VS Code, unzip it and run the integration test
		await runTests({ extensionDevelopmentPath, extensionTestsPath });
	} catch (err) {
		console.error('Failed to run tests');
		console.error(err);
		process.exit(1);
	}
}

main();
