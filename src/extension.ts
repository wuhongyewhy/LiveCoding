'use strict';
import * as vscode from "vscode";
import PreviewManager from "./PreviewManager"
import vscodeUtils from "./vscodeUtilities";

let previewManager: PreviewManager = null;

export function activate(context: vscode.ExtensionContext) {

    previewManager = new PreviewManager(context);

    // Register the commands that are provided to the user
    const livecode = vscode.commands.registerCommand("livecode2.currentSession", () => {
        previewManager.startlivecode();
    });

    const newlivecodeSession = vscode.commands.registerCommand("livecode2.newSession", ()=>{
        vscodeUtils.newUnsavedPythonDoc(vscodeUtils.getHighlightedText())
            .then(()=>{previewManager.startlivecode()});
    });

    const closelivecode = vscode.commands.registerCommand("livecode2.close", ()=>{
        previewManager.dispose()
    });

    // exact same as above, just defining command so users are aware of the feature
    const livecodeOnHighlightedCode = vscode.commands.registerCommand("livecode2.newSessionOnHighlightedCode", ()=>{
        vscodeUtils.newUnsavedPythonDoc(vscodeUtils.getHighlightedText())
            .then(()=>{previewManager.startlivecode()});
    });

    const executelivecode = vscode.commands.registerCommand("livecode2.execute", () => {
        previewManager.runlivecode()
    });

    const executelivecodeBlock = vscode.commands.registerCommand("livecode2.executeBlock", () => {
        previewManager.runlivecodeBlock()
    });

    const printDir = vscode.commands.registerCommand("livecode2.printDir", () => {
        previewManager.printDir()
    });

    // push to subscriptions list so that they are disposed automatically
    context.subscriptions.push(...[
        livecode,
        newlivecodeSession,
        closelivecode,
        livecodeOnHighlightedCode,
        executelivecode,
        executelivecodeBlock,
        printDir
    ]);
}
