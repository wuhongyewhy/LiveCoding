'use strict';
import * as vscode from "vscode";
import PreviewManager from "./PreviewManager"
import vscodeUtils from "./vscodeUtilities";

let previewManager: PreviewManager = null;

export function activate(context: vscode.ExtensionContext) {

    previewManager = new PreviewManager(context);

    // Register the commands that are provided to the user
    const livecode = vscode.commands.registerCommand("live-coding.currentSession", () => {
        previewManager.startlivecode();
    });

    const newlivecodeSession = vscode.commands.registerCommand("live-coding.newSession", ()=>{
        vscodeUtils.newUnsavedPythonDoc(vscodeUtils.getHighlightedText())
            .then(()=>{previewManager.startlivecode()});
    });

    const closelivecode = vscode.commands.registerCommand("live-coding.close", ()=>{
        previewManager.dispose()
    });

    // exact same as above, just defining command so users are aware of the feature
    const livecodeOnHighlightedCode = vscode.commands.registerCommand("live-coding.newSessionOnHighlightedCode", ()=>{
        vscodeUtils.newUnsavedPythonDoc(vscodeUtils.getHighlightedText())
            .then(()=>{previewManager.startlivecode()});
    });

    const executelivecode = vscode.commands.registerCommand("live-coding.execute", () => {
        previewManager.runlivecode()
    });

    const executelivecodeBlock = vscode.commands.registerCommand("live-coding.executeBlock", () => {
        previewManager.runlivecodeBlock()
    });

    const printDir = vscode.commands.registerCommand("live-coding.printDir", () => {
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
