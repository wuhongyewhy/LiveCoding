"use strict"
import * as path from "path";
import * as vscode from "vscode"
import { Limit } from "./throttle"
import Utilities from "./utilities"
import { settings } from "./settings"

/**
 * shows AREPL output (variables, errors, timing, and stdout/stderr)
 * https://code.visualstudio.com/docs/extensions/webview
 */
export default class PythonPanelPreview {

    static readonly scheme = "pythonPanelPreview"
    static readonly PREVIEW_URI = PythonPanelPreview.scheme + "://authority/preview"
    public throttledUpdate: () => void

    private _onDidChange: vscode.EventEmitter<vscode.Uri>;
    private lastTime: number = 999999999;

    public html;

    private readonly landingPage = `<br>
    <p style="font-size:14px">Start typing or make a change and your code will be evaluated.</p>
    
    <p style="font-size:14px">⚠ <b style="color:red">WARNING:</b> code is evaluated WHILE YOU TYPE - don't try deleting files/folders! ⚠</p>
    <p>evaluation while you type can be turned off or adjusted in the settings</p>
    <br>
    
    <h3>Examples</h3>
    
    <h4>Simple List</h4>
    <code style="white-space:pre-wrap">
    x = [1,2,3]
    y = [num*2 for num in x]
    print(y)
    </code>
    
    <h4>Web call</h4>
    <code style="white-space:pre-wrap">
    import requests
    import datetime as dt
    
    r = requests.get("https://api.github.com")
    
    #$save
    # #$save saves state so request is not re-executed when modifying below
    
    now = dt.datetime.now()
    if r.status_code == 200:
        print("API up at " + str(now))
    
    </code>`;


    private css: string = ""
    private jsonRendererScript: string = "";
    private cspMeta: string = ""
    private errorContainer = ""
    private jsonRendererCode = `<script></script>`;
    private emptyPrint = ``
    private printContainer = this.emptyPrint;
    private timeContainer = ""
    public panel: vscode.WebviewPanel
    public startrange = 0
    private customCSS = ""
    private varsPlainText = `<pre id="results-plain" class="vars-plain">尚未生成变量</pre>`
    private renderCount = 0
    private scriptNonce: string = this.generateNonce()

    private showSourceCode = true;
    private showDebugMode = false;

    // Saturated colors for better visibility
    private distinctColors = [
        "#90CAF9", // Blue 200
        "#A5D6A7", // Green 200
        "#EF9A9A", // Red 200
        "#FFF59D", // Yellow 200
        "#CE93D8", // Purple 200
        "#FFCC80", // Orange 200
        "#80CBC4", // Teal 200
        "#9FA8DA"  // Indigo 200
    ];

    constructor(private context: vscode.ExtensionContext, htmlUpdateFrequency = 50) {
        this._onDidChange = new vscode.EventEmitter<vscode.Uri>();
        this.refreshStaticAssets()

        if (htmlUpdateFrequency != 0) {
            // refreshing html too much can freeze vscode... lets avoid that
            const l = new Limit()
            this.throttledUpdate = l.throttledUpdate(this.updateContent, htmlUpdateFrequency)
        }
        else this.throttledUpdate = this.updateContent
    }

    start(linkedFileName: string) {
        this.panel = vscode.window.createWebviewPanel("live-coding", "live coding for python - " + linkedFileName, vscode.ViewColumn.Two, {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, "media"))
            ]
        });

        this.panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'toggleSource':
                    this.showSourceCode = message.value;
                    break;
                case 'toggleDebug':
                    this.showDebugMode = message.value;
                    break;
                case 'install-space-tracer':
                    // Handled by PreviewManager usually, but we can leave this here if needed
                    break;
            }
        });

        this.refreshStaticAssets()
        // this.startContent();
        this.panel.webview.html = this.landingPage

        return this.panel;
    }

    public updateVars(vars: object) {
        this.renderCount += 1
        this.scriptNonce = this.generateNonce()
        this.refreshStaticAssets()
        let userVarsCode = `window.userVars = ${JSON.stringify(vars)};`

        // escape end script tag or else the content will escape its container and WREAK HAVOC
        userVarsCode = userVarsCode.replace(/<\/script>/g, "<\\/script>")

        this.jsonRendererCode = `<script nonce="${this.scriptNonce}">
            (function(){
                const render = () => {
                    window.scrollTo(0, 19 * ${this.startrange});
                    ${userVarsCode}
                    const container = document.getElementById("results");
                    if(!container) return;
                    container.innerHTML = "";
                    let jsonRenderer = renderjson.set_icons('+', '-')
                        .set_show_to_level(${settings().get("show_to_level")}) 
                        .set_max_string_length(${settings().get("max_string_length")});
                    container.appendChild(jsonRenderer(userVars));
                    
                    var setscroll = ${this.startrange};
                    window.scrollTo(0, 19 * setscroll);
                    window.addEventListener("message", event => {
                        var scrolllevel = event.data.line;
                        window.scrollTo(0, 19 * scrolllevel);
                    });

                    const fallback = document.getElementById("results-plain");
                    if(fallback) fallback.style.display = "none";
                };

                if(document.readyState === "loading"){
                    window.addEventListener("DOMContentLoaded", render, { once: true });
                } else {
                    render();
                }
            })();
            </script>`

        const rawVars = (vars as any)?.rawVariables ?? vars
        const plainJson = JSON.stringify(rawVars, null, 2) || "{}"
        const escapedPlainJson = Utilities.escapeHtml(plainJson)
        this.varsPlainText = `<pre id="results-plain" class="vars-plain">${escapedPlainJson}</pre>`

        this.throttledUpdate();
    }

    public updateTime(time: number) {
        let color: "green" | "red";

        time = Math.floor(time) // we dont care about anything smaller than ms

        if (time > this.lastTime) color = "red"
        else color = "green"

        this.lastTime = time;

        this.timeContainer = `<p style="position:fixed;left:93%;top:96%;color:${color};">${time} ms</p>`;
    }

    /**
     * @param refresh if true updates page immediately.  otherwise error will show up whenever updateContent is called
     */
    public updateError(err: string, refresh = false) {
        // escape the <module>
        err = Utilities.escapeHtml(err)

        err = this.makeErrorGoogleable(err)

        this.errorContainer = `<div id="error">${err}</div>`

        if (refresh) this.throttledUpdate()
    }

    public injectCustomCSS(css: string, refresh = false) {
        this.customCSS = css
        if (refresh) this.throttledUpdate()
    }

    public handlePrint(printResults: string) {
        // escape any accidental html
        printResults = Utilities.escapeHtml(printResults);
        this.printContainer = `<br><h3>Print Output:</h3><div class="print">${printResults}</div>`
        this.throttledUpdate();
    }

    public showTrace(trace: string, code: string, pythonPath: string) {
        const tableHtml = this.renderTraceTable(code, trace, pythonPath);
        this.varsPlainText = `<div id="results-plain" class="vars-plain">${tableHtml}</div>`
        this.printContainer = this.emptyPrint
        this.errorContainer = ""
        this.timeContainer = ""
        this.throttledUpdate()
    }

    private renderTraceTable(code: string, trace: string, pythonPath: string): string {
        const codeLines = code.split(/\r?\n/);
        const traceLines = trace.split(/\r?\n/);

        // Pass 1: Identify ALL separator indices
        const allPipeIndices = new Set<number>();
        traceLines.forEach(line => {
            for (let i = 0; i < line.length; i++) {
                if (line[i] === '|') {
                    allPipeIndices.add(i);
                }
            }
        });
        const separatorIndices = Array.from(allPipeIndices).sort((a, b) => a - b);

        const sourceChecked = this.showSourceCode ? 'checked' : '';
        const sourceDisplay = this.showSourceCode ? 'table-cell' : 'none';
        const debugChecked = this.showDebugMode ? 'checked' : '';
        const debugDisplay = this.showDebugMode ? 'block' : 'none';

        // State for multi-level nesting: map grid column index to stack of parent cells
        // Each element is a stack of { color, colspan } representing active scopes
        // const gridColumnState: { color: string, colspan: number }[][] = [];

        let html = `
        <table class="trace-table" style="width:100%; border-collapse: collapse; border: 1px solid #ccc;">`;

        for (let i = 0; i < codeLines.length; i++) {
            const codeLine = codeLines[i];
            const traceLine = i < traceLines.length ? traceLines[i] : "";

            html += '<tr>';
            html += `<td class="code-col" style="white-space: pre; border-right: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 0; vertical-align: top; background-color: #f5f5f5; display: ${sourceDisplay}; background-clip: border-box;"><div style="padding: 5px">${Utilities.escapeHtml(codeLine)}</div></td>`;

            let currentIdx = 0;
            let colSpan = 1;
            let segmentStart = 0;
            let currentGridColumn = 0;

            for (let s = 0; s < separatorIndices.length; s++) {
                const sepIdx = separatorIndices[s];
                const hasPipe = sepIdx < traceLine.length && traceLine[sepIdx] === '|';

                if (hasPipe) {
                    let content = traceLine.substring(segmentStart, sepIdx);

                    // Determine color
                    let bgColor = this.getDistinctColor(currentGridColumn);

                    let style = `white-space: pre; vertical-align: top; background-color: ${bgColor}; min-width: 20px; background-clip: border-box; padding: 0; border: none;`;

                    const safeContent = content === "" ? "&nbsp;" : Utilities.escapeHtml(content);
                    html += `<td class="trace-col" colspan="${colSpan}" style="${style}"><div style="padding: 5px">${safeContent}</div></td>`;

                    segmentStart = sepIdx + 1;
                    currentGridColumn += colSpan;
                    colSpan = 1;
                } else {
                    colSpan++;
                }
            }

            // Last segment
            let lastContent = "";
            if (segmentStart < traceLine.length) {
                lastContent = traceLine.substring(segmentStart);
            }

            let bgColor;
            if (!traceLine.includes('|')) {
                bgColor = "#f5f5f5";
            } else {
                bgColor = this.getDistinctColor(currentGridColumn);
            }

            let style = `white-space: pre; vertical-align: top; background-color: ${bgColor}; min-width: 20px; background-clip: border-box; padding: 0; border: none;`;

            const safeLastContent = lastContent === "" ? "&nbsp;" : Utilities.escapeHtml(lastContent);
            html += `<td class="trace-col" colspan="${colSpan}" style="${style}"><div style="padding: 5px">${safeLastContent}</div></td>`;

            html += '</tr>';
        }

        html += '</table>';
        html += `<div id="debug-output" style="display: ${debugDisplay}; margin-top: 20px; padding: 10px; background-color: #eee; border: 1px solid #999; white-space: pre-wrap; font-family: monospace;"><h3>Raw Trace Output:</h3>${Utilities.escapeHtml(trace)}</div>`;

        // Footer with Python Path and Options
        html += `<div style="margin-top: 5px; padding: 5px 5px 0 5px; background-color: #f0f0f0; border-top: 1px solid #ccc; font-size: 12px; white-space: normal;"><div style="margin-bottom: 10px;"><strong>Python Path: ${Utilities.escapeHtml(pythonPath)}</strong></div><div style="display: flex; gap: 10px; margin-bottom: 0;"><label style="cursor: pointer;"><input type="checkbox" id="cb-show-debug" ${debugChecked} style="vertical-align: middle;"> Debug Mode</label><label style="cursor: pointer;"><input type="checkbox" id="cb-show-source" ${sourceChecked} style="vertical-align: middle;"> Show Source Code</label></div></div>`;

        html += `
        <script nonce="${this.scriptNonce}">
            (function() {
                const vscode = acquireVsCodeApi();
                const cbSource = document.getElementById('cb-show-source');
                const cbDebug = document.getElementById('cb-show-debug');
                
                if (cbSource) {
                    cbSource.addEventListener('change', (e) => {
                        const checked = e.target.checked;
                        document.querySelectorAll('.code-col').forEach(el => el.style.display = checked ? 'table-cell' : 'none');
                        vscode.postMessage({ command: 'toggleSource', value: checked });
                    });
                }
                
                if (cbDebug) {
                    cbDebug.addEventListener('change', (e) => {
                        const checked = e.target.checked;
                        const debugDiv = document.getElementById('debug-output');
                        if (debugDiv) debugDiv.style.display = checked ? 'block' : 'none';
                        vscode.postMessage({ command: 'toggleDebug', value: checked });
                    });
                }
            })();
        </script>`;

        return html;
    }

    private getDistinctColor(index: number): string {
        return this.distinctColors[index % this.distinctColors.length];
    }

    private hexToRgb(hex: string): { r: number, g: number, b: number } {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 255, b: 255 };
    }

    private getAverageColor(startIndex: number, span: number): string {
        let rSum = 0, gSum = 0, bSum = 0;
        for (let i = 0; i < span; i++) {
            const color = this.hexToRgb(this.getDistinctColor(startIndex + i));
            rSum += color.r;
            gSum += color.g;
            bSum += color.b;
        }
        return `rgb(${Math.round(rSum / span)}, ${Math.round(gSum / span)}, ${Math.round(bSum / span)})`;
    }

    /**
     * Show a missing dependency prompt with an install button that posts back to the extension host.
     * The caller must register a webview message handler for command 'install-space-tracer'.
     */
    public showSpaceTracerInstallPrompt(message: string) {
        // refresh CSP + assets with a new nonce so the inline script is allowed
        this.scriptNonce = this.generateNonce()
        this.refreshStaticAssets()

        const safeMsg = Utilities.escapeHtml(message)
        this.varsPlainText = `
            <div class="install-missing">
                <p>${safeMsg}</p>
                <button id="install-space-tracer" style="margin-top:8px;padding:6px 12px;">安装 space_tracer</button>
                <script nonce="${this.scriptNonce}">
                    const vscodeApi = acquireVsCodeApi();
                    const btn = document.getElementById("install-space-tracer");
                    if(btn){
                        btn.addEventListener("click", ()=>{
                            vscodeApi.postMessage({ command: "install-space-tracer" });
                        });
                    }
                </script>
            </div>
        `;
        this.printContainer = this.emptyPrint
        this.errorContainer = ""
        this.timeContainer = ""
        this.throttledUpdate()
    }

    clearPrint() {
        this.printContainer = this.emptyPrint
    }

    public displayProcessError(err: string) {
        let errMsg = `Error in the LiveCode extension!\n${err}`
        if (err.includes("ENOENT") || err.includes("9009")) { // NO SUCH FILE OR DIRECTORY
            // user probably just doesn't have python installed
            errMsg = errMsg + `\n\nAre you sure you have installed python 3 and it is in your PATH?
            You can download python here: https://www.python.org/downloads/`
        }

        this.updateError(errMsg, true)
    }

    private makeErrorGoogleable(err: string) {
        if (err && err.trim().length > 0) {
            let errLines = err.split("\n")

            // exception usually on last line so start from bottom
            for (let i = errLines.length - 1; i >= 0; i--) {

                // most exceptions follow format ERROR: explanation
                // ex: json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
                // so we can identify them by a single word at start followed by colon
                const errRegex = /(^[\w\.]+): /
                const lineRegex = /line (\d+)/

                if (errLines[i].match(lineRegex)) {
                    errLines[i] = ""
                }

                if (errLines[i].match(errRegex)) {
                    const googleLink = "https://www.google.com/search?q=python "
                    errLines[i] = errLines[i].link(googleLink + errLines[i])
                }
            }

            return errLines.join("\n")
        }
        else return err
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    private getMediaPath(mediaFile: string) {
        const onDiskPath = vscode.Uri.file(path.join(this.context.extensionPath, "media", mediaFile));
        if (this.panel && (this.panel.webview as any).asWebviewUri) {
            const asUri = (this.panel.webview as any).asWebviewUri(onDiskPath) as vscode.Uri
            return asUri.toString()
        }
        return onDiskPath.with({ scheme: "vscode-resource" }).toString();
    }

    private generateNonce() {
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        let text = ""
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length))
        }
        return text
    }

    private refreshStaticAssets() {
        const cssPath = this.getMediaPath("pythonPanelPreview.css")
        const webview = this.panel?.webview
        const cspSource = webview?.cspSource
        if (cspSource) {
            this.cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; script-src 'nonce-${this.scriptNonce}' ${cspSource}; style-src 'unsafe-inline' ${cspSource}; font-src ${cspSource};">`
        } else {
            this.cspMeta = ""
        }
        this.css = `<link rel="stylesheet" type="text/css" href="${cssPath}">`
        const jsonRendererPath = this.getMediaPath("jsonRenderer.js")
        this.jsonRendererScript = `<script nonce="${this.scriptNonce}" src="${jsonRendererPath}"></script>`
    }

    private updateContent() {

        const printPlacement = settings().get<string>("printResultPlacement")
        const showFooter = settings().get<boolean>("showFooter")
        const variables = `<div id="break"><br></div><div id="results"></div>${this.varsPlainText}`
        // removed <h3>Variables:</h3> from var above

        // todo: handle different themes.  check body class: https://code.visualstudio.com/updates/June_2016
        this.html = `<!doctype html>
        <html lang="en">
        <head>
            <title>live coding for python</title>
            ${this.cspMeta}
            ${this.css}
            <style>${this.customCSS}</style>
            ${this.jsonRendererScript}
            ${this.jsonRendererCode}
        </head>
        <body>
            ${printPlacement == "bottom" ?
                variables + this.errorContainer :
                this.errorContainer + variables}
            
            <br><br><br><br>
            ${this.timeContainer}
            <div id="${Math.random()}" style="display:none"></div>
            <div id="739177969589762537283729281" style="display:none"></div></body></html>`
        // the weird div with a random id above is necessary
        // if not there weird issues appear
        // ${showFooter ? this.footer : ""}
        try {
            this.panel.webview.html = this.html;
        } catch (error) {
            if (error instanceof Error && error.message.includes("disposed")) {
                // swallow - user probably just got rid of webview inbetween throttled update call
                console.warn(error)
            }
            else throw error
        }

        this._onDidChange.fire(vscode.Uri.parse(PythonPanelPreview.PREVIEW_URI));
    }

}
