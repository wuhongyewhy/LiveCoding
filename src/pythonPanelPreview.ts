"use strict"
import * as path from "path";
import * as vscode from "vscode"
import {Limit} from "./throttle"
import Utilities from "./utilities"
import {settings} from "./settings"

/**
 * shows AREPL output (variables, errors, timing, and stdout/stderr)
 * https://code.visualstudio.com/docs/extensions/webview
 */
export default class PythonPanelPreview{
    
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
    

    constructor(private context: vscode.ExtensionContext, htmlUpdateFrequency=50) {
        this._onDidChange = new vscode.EventEmitter<vscode.Uri>();
        this.refreshStaticAssets()

        if(htmlUpdateFrequency != 0){
            // refreshing html too much can freeze vscode... lets avoid that
            const l = new Limit()
            this.throttledUpdate = l.throttledUpdate(this.updateContent, htmlUpdateFrequency)
        }
        else this.throttledUpdate = this.updateContent
    }

    start(linkedFileName: string){
        this.panel = vscode.window.createWebviewPanel("live-coding","live coding for python - " + linkedFileName, vscode.ViewColumn.Two,{
            enableScripts:true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, "media"))
            ]
        });
        this.refreshStaticAssets()
        // this.startContent();
        this.panel.webview.html = this.landingPage

        return this.panel;
    }

    public updateVars(vars: object){
        this.renderCount += 1
        this.scriptNonce = this.generateNonce()
        this.refreshStaticAssets()
        let userVarsCode = `window.userVars = ${JSON.stringify(vars)};`

        // escape end script tag or else the content will escape its container and WREAK HAVOC
        userVarsCode = userVarsCode.replace(/<\/script>/g, "<\\/script>")


        // this.jsonRendererCode = `<script>
        //     window.onload = function(){
        //         ${userVarsCode}
        //         let jsonRenderer = renderjson.set_icons('+', '-') // default icons look a bit wierd, overriding
        //             .set_show_to_level(${settings().get("show_to_level")}) 
        //             .set_max_string_length(${settings().get("max_string_length")});
        //         document.getElementById("results").appendChild(jsonRenderer(userVars));
        //         var cuthere_sdhakdjenamsjdalskxnlyndkja = 0; 
        //         var current_scroll_level = 0; 
        //         var cuthere_sdhakdjenamsjdalskxnlyndkja = 0; 
        //         this.scrollTo(0, current_scroll_level);

        //     }
        //     </script>`


                
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
    // this.scroll(1000, 1000);

    public updateTime(time: number){
        let color: "green"|"red";

        time = Math.floor(time) // we dont care about anything smaller than ms
        
        if(time > this.lastTime) color = "red"
        else color = "green"

        this.lastTime = time;

        this.timeContainer = `<p style="position:fixed;left:93%;top:96%;color:${color};">${time} ms</p>`;
    }

    /**
     * @param refresh if true updates page immediately.  otherwise error will show up whenever updateContent is called
     */
    public updateError(err: string, refresh=false){
        // escape the <module>
        err = Utilities.escapeHtml(err)

        err = this.makeErrorGoogleable(err)

        this.errorContainer = `<div id="error">${err}</div>`

        if(refresh) this.throttledUpdate()
    }

    public injectCustomCSS(css: string, refresh=false){
        this.customCSS = css
        if(refresh) this.throttledUpdate()
    }

    public handlePrint(printResults: string){
        // escape any accidental html
        printResults = Utilities.escapeHtml(printResults);

        this.printContainer = `<br><h3>Print Output:</h3><div class="print">${printResults}</div>`
        this.throttledUpdate();
    }

    public showTrace(trace: string){
        const escaped = Utilities.escapeHtml(trace);
        this.varsPlainText = `<pre id="results-plain" class="vars-plain">${escaped}</pre>`
        this.printContainer = this.emptyPrint
        this.errorContainer = ""
        this.timeContainer = ""
        this.throttledUpdate()
    }

    clearPrint(){
        this.printContainer = this.emptyPrint
    }

    public displayProcessError(err: string){
        let errMsg = `Error in the LiveCode extension!\n${err}`
        if(err.includes("ENOENT") || err.includes("9009")){ // NO SUCH FILE OR DIRECTORY
            // user probably just doesn't have python installed
            errMsg = errMsg + `\n\nAre you sure you have installed python 3 and it is in your PATH?
            You can download python here: https://www.python.org/downloads/`
        }

        this.updateError(errMsg, true)
    }

    private makeErrorGoogleable(err: string){
        if(err && err.trim().length > 0){
            let errLines = err.split("\n")

            // exception usually on last line so start from bottom
            for(let i=errLines.length-1; i>=0; i--){

                // most exceptions follow format ERROR: explanation
                // ex: json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
                // so we can identify them by a single word at start followed by colon
                const errRegex = /(^[\w\.]+): /
                const lineRegex = /line (\d+)/

                if(errLines[i].match(lineRegex)){
                    errLines[i] = ""
                }

                if(errLines[i].match(errRegex)){
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
        if(this.panel && (this.panel.webview as any).asWebviewUri){
            const asUri = (this.panel.webview as any).asWebviewUri(onDiskPath) as vscode.Uri
            return asUri.toString()
        }
        return onDiskPath.with({ scheme: "vscode-resource" }).toString();
    }

    private generateNonce(){
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        let text = ""
        for(let i=0; i<32; i++){
            text += possible.charAt(Math.floor(Math.random() * possible.length))
        }
        return text
    }

    private refreshStaticAssets(){
        const cssPath = this.getMediaPath("pythonPanelPreview.css")
        const webview = this.panel?.webview
        const cspSource = webview?.cspSource
        if(cspSource){
            this.cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; script-src 'nonce-${this.scriptNonce}' ${cspSource}; style-src 'unsafe-inline' ${cspSource}; font-src ${cspSource};">`
        } else {
            this.cspMeta = ""
        }
        this.css = `<link rel="stylesheet" type="text/css" href="${cssPath}">`
        const jsonRendererPath = this.getMediaPath("jsonRenderer.js")
        this.jsonRendererScript = `<script nonce="${this.scriptNonce}" src="${jsonRendererPath}"></script>`
    }

    private updateContent(){

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
            if(error instanceof Error && error.message.includes("disposed")){
                // swallow - user probably just got rid of webview inbetween throttled update call
                console.warn(error)
            }
            else throw error
        }

        this._onDidChange.fire(vscode.Uri.parse(PythonPanelPreview.PREVIEW_URI));
    }

  

}
