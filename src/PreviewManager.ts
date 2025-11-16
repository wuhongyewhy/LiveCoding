"use strict"
import livecode2Utils from "./livecodeUtilities"
import * as vscode from "vscode"
import { EnvironmentVariablesProvider } from "./env/variables/environmentVariablesProvider"
import { EnvironmentVariablesService } from "./env/variables/environment"
import { join, basename, dirname } from "path";
import * as fs from "fs"
import * as os from "os"
import { spawn, ChildProcess } from "child_process"
import { PreviewContainer } from "./previewContainer"
import Reporter from "./telemetry"
import { PythonShell } from "python-shell"
import {settings} from "./settings"
import printDir from "./printDir";
import { PlatformService } from "./env/platform/platformService"
import { PathUtils } from "./env/platform/pathUtils"
import vscodeUtils from "./vscodeUtilities"
import { WorkspaceService } from "./env/application/workspace"
import { Position, Range } from "vscode"

/**
 * class with logic for starting livecode2 and its preview
 */
export default class PreviewManager {

    reporter: Reporter;
    disposable: vscode.Disposable;
    pythonEditorDoc: vscode.TextDocument;
    runningStatus: vscode.StatusBarItem;
    tolivecodeLogic: any
    previewContainer: PreviewContainer
    subscriptions: vscode.Disposable[] = []
    highlightDecorationType: vscode.TextEditorDecorationType
    pythonEditor: vscode.TextEditor;
    private traceProcess: ChildProcess | null = null
    private changeTimer: NodeJS.Timeout | null = null

    /**
     * assumes a text editor is already open - if not will error out
     */
    constructor(context: vscode.ExtensionContext) {
        this.runningStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.runningStatus.text = "Running python..."
        this.runningStatus.tooltip = "livecode2 is currently running your python file.  Close the livecode2 preview to stop"
        this.reporter = new Reporter(settings().get<boolean>("telemetry"))
        this.previewContainer = new PreviewContainer(this.reporter, context)

        this.highlightDecorationType = vscode.window.createTextEditorDecorationType(<vscode.ThemableDecorationRenderOptions>{
            backgroundColor: 'yellow'
        })
    }

    async loadAndWatchEnvVars(){
        const platformService = new PlatformService()
        const envVarsService = new EnvironmentVariablesService(new PathUtils(platformService.isWindows))
        const workspaceService = new WorkspaceService()
        const e = new EnvironmentVariablesProvider(envVarsService,
            this.subscriptions,
            platformService,
            workspaceService,
            process)
        return e.getEnvironmentVariables(livecode2Utils.getEnvFilePath(), vscodeUtils.getCurrentWorkspaceFolderUri())
    }

    async startlivecode(){
        // see https://github.com/Microsoft/vscode/issues/46445
        vscode.commands.executeCommand("setContext", "livecode2", true)

        // reload reporter (its disposed when livecode2 is closed)
        this.reporter = new Reporter(settings().get<boolean>("telemetry"))

        if(!vscode.window.activeTextEditor){
            vscode.window.showErrorMessage("no active text editor open")
            return
        }
        this.pythonEditor = vscode.window.activeTextEditor
        // var ranges = this.pythonEditor.visibleRanges
        // console.log(ranges)
        // var tt = new vscode.Range(100,0,101,0)
        // console.log(tt)
        // this.pythonEditor.revealRange(tt, 3)
        
        // vscode.onDidChangeTextEditorVisibleRanges()
        // needs window not editor, look at github example of use of event
        // this.subscriptions.push(
        // vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        //     console.log(event.textEditor.visibleRanges[0].start.line)
        // })
        // )
        this.pythonEditorDoc = this.pythonEditor.document
        this.previewContainer.setActiveDocument(this.pythonEditorDoc)
        

        let panel = this.previewContainer.start(basename(this.pythonEditorDoc.fileName));
        panel.onDidDispose(()=>this.dispose(), this, this.subscriptions)
        this.subscriptions.push(panel)

        // only space_tracer is used now – no AREPL backend startup

        if(this.pythonEditorDoc.isUntitled && this.pythonEditorDoc.getText() == "") {
            await livecode2Utils.insertDefaultImports(this.pythonEditor)
            // waiting for this to complete so i dont accidentily trigger
            // the edit doc handler when i insert imports
        }

        this.subscribeHandlersToDoc()
        

        // function resolveAfter2Seconds() {
        //     return new Promise(resolve => {
        //       setTimeout(() => {
        //         resolve('resolved');
        //       }, 2000);
        //     });
        //   }
          
        //   async function asyncCall() {
        //     const result = await resolveAfter2Seconds();

        // async function littleadd(){
        //     this.pythonEditor.edit((builder) => {
        //         builder.insert(new vscode.Position(0,0 ), "    ");
                
        //     });
        //     return;
        // }
        // littleadd();

        var lc = this.pythonEditorDoc.lineCount

        var lastline_text = this.pythonEditorDoc.lineAt(lc -1)

        var lastline_end = lastline_text.text.length

        if (lc > 1 || lastline_end > 0) {


        

            this.pythonEditor.edit((builder) => {
                
                builder.insert(new vscode.Position(lc - 1, lastline_end ), "\n");

            });

            
        //             this.pythonEditor.edit((remover) => {
        //     // builder.delete(new vscode.Range(new vscode.Position(lc -1 ,lastline_end - 1 ), new vscode.Position(lc -1 ,lastline_end + 1 )));
        //     // builder.delete(new vscode.Range(new vscode.Position(78 ,0 ), new vscode.Position(79, 0 )));
        //     var nrange = new vscode.Range( 78,0,78,2)
        //     console.log(nrange)
        //     remover.delete(nrange);
        // });


        }
        // //   }
        
        // // asyncCall()

        // const secondFunction = async () => {
        //     await littleadd()
        //     // do something else here after firstFunction completes
        //     this.pythonEditor.edit((builder) => {
        //         builder.delete(new vscode.Range(new vscode.Position(0,0 ), new vscode.Position(0,1 )));
        //     });
        //   }
        // secondFunction();

        // this.pythonEditor.edit((builder) => {
        //     builder.delete(new vscode.Range(new vscode.Position(0,0 ), new vscode.Position(0,0 )));
        // });

        return panel
    }

    runlivecode(){
        if(this.pythonEditorDoc){
            this.runSpaceTracerForDoc(this.pythonEditorDoc)
        }
    }

    /**
     * adds print() or print(dir()) if line ends in .
     * ex: x=1; print(x)
     * Then runs it
     */
    printDir(){

        if(this.pythonEditor != vscode.window.activeTextEditor) return
        const selection = this.pythonEditor.selection
        if(!selection.isSingleLine) return
        let codeLines = this.pythonEditor.document.getText()

        let codeLinesArr = printDir(codeLines.split(vscodeUtils.eol(this.pythonEditor.document)), selection.start.line)
        // todo: how to connect this with onAnyDocChange?
    }

    runlivecodeBlock() {
        if(this.pythonEditorDoc){
            this.runSpaceTracerForDoc(this.pythonEditorDoc)
        }
    }

    dispose() {
        vscode.commands.executeCommand("setContext", "livecode2", false)

        this.disposable = vscode.Disposable.from(...this.subscriptions);
        this.disposable.dispose();

        this.runningStatus.dispose();
        
        this.reporter.sendFinishedEvent(settings())
        this.reporter.dispose();

        if(vscode.window.activeTextEditor){
            vscode.window.activeTextEditor.setDecorations(this.previewContainer.errorDecorationType, [])
        }
    }

    /**
     * show err message to user if outdated version of python
     */
    private warnIfOutdatedPythonVersion(pythonPath: string){
        PythonShell.getVersion(`"${pythonPath}"`).then((out)=>{
            let version = out.stdout ? out.stdout : out.stderr
            if(version?.includes("Python 3.4") || version?.includes("Python 2")){
                vscode.window.showErrorMessage(`livecode2 does not support ${version}.
                Please upgrade or set livecode2.pythonPath to a diffent python.
                livecode2 needs python 3.5 or greater`)
            }
            if(version){
                this.reporter.pythonVersion = version.trim()
            }
        }).catch((err: NodeJS.ErrnoException)=>{
            // if we get spawn error here thats already reported by telemetry
            // so we skip telemetry reporting for this error
            console.error(err)
            if(err.message.includes("Python was not found but can be installed from the Microsoft Store")){
                vscode.window.showErrorMessage(err.message)
            }
        })
    }

    /**
     * run space_tracer on current code and show its textual output
     */
    private runSpaceTracer(code: string, filePath: string){
        const workspaceFolder = vscodeUtils.getCurrentWorkspaceFolder(false) || undefined
        const pythonPath = livecode2Utils.getPythonPath()

        // write code to temp file
        const baseName = basename(filePath || "untitled.py")
        const safeBase = baseName.replace(/[^\w\.]+/g, "_")
        const tempFile = join(os.tmpdir(), `livecode2_${safeBase}`)

        try {
            fs.writeFileSync(tempFile, code, { encoding: "utf8" })
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            this.previewContainer.showTrace(`写入临时文件失败: ${msg}`)
            return
        }

        // cancel previous trace process
        if(this.traceProcess){
            try {
                this.traceProcess.kill()
            } catch {}
            this.traceProcess = null
        }

        const args = ["-m", "space_tracer", tempFile]
        const proc = spawn(pythonPath, args, {
            cwd: workspaceFolder ? workspaceFolder : dirname(tempFile),
            env: process.env
        })
        this.traceProcess = proc

        let stdout = ""
        let stderr = ""

        proc.stdout.on("data", data => {
            stdout += data.toString()
        })
        proc.stderr.on("data", data => {
            stderr += data.toString()
        })

        proc.on("close", code => {
            if(this.traceProcess !== proc) return  // newer run started
            this.traceProcess = null
            this.runningStatus.hide()

            if(code === 0){
                this.previewContainer.showTrace(stdout || "(space_tracer 没有输出)")
            } else {
                const combined = [stdout, stderr].filter(Boolean).join("\n").trim()
                this.previewContainer.showTrace(
                    combined || `space_tracer 退出码: ${code}`
                )
            }
        })

        proc.on("error", err => {
            const msg = err instanceof Error ? err.message : String(err)
            this.runningStatus.hide()
            this.previewContainer.showTrace(`启动 space_tracer 失败: ${msg}`)
        })
    }

    private change_line_view() {
        const editor = vscode.window.activeTextEditor
        if(!editor || editor.visibleRanges.length === 0) return
        const panel = this.previewContainer?.pythonPanelPreview?.panel
        if(!panel || panel.webview === undefined) return

        const curline = editor.visibleRanges[0].start.line
        panel.webview.postMessage({ line: curline })
    }
    // legacy AREPL backend startup removed – livecode2 now uses space_tracer only

    /**
     * binds various funcs to activate upon edit of document / switching of active doc / etc...
     */
    private subscribeHandlersToDoc(){

        if(settings().get<boolean>("skipLandingPage")){
            if(this.pythonEditorDoc){
                this.runSpaceTracerForDoc(this.pythonEditorDoc)
            }
        }

        
        vscode.workspace.onDidSaveTextDocument((e) => {
            if(settings().get<string>("whenToExecute") == "onSave"){
                this.runSpaceTracerForDoc(e)
            }
        }, this, this.subscriptions)
        
        vscode.workspace.onDidChangeTextDocument((e) => {
            const cachedSettings = settings()
            if(cachedSettings.get<string>("whenToExecute") == "afterDelay"){
                let delay = cachedSettings.get<number>("delay");
                if(this.changeTimer){
                    clearTimeout(this.changeTimer)
                }
                this.changeTimer = setTimeout(() => {
                    this.runSpaceTracerForDoc(e.document)
                }, delay)
            }
        }, this, this.subscriptions)
        
        

            vscode.window.onDidChangeTextEditorVisibleRanges((event) => {

            
            this.change_line_view();


            },this, this.subscriptions )
            











        vscode.workspace.onDidCloseTextDocument((e) => {
            if(e == this.pythonEditorDoc) this.dispose()
        }, this, this.subscriptions)
    
    
    
    
    
    
    
    
    
    }


    private onAnyDocChange(event: vscode.TextDocument){
        if(event == this.pythonEditorDoc){

            this.reporter.numRuns += 1

            const text = event.getText()

            let filePath = ""
            if(this.pythonEditorDoc.isUntitled){
                /* user would assume untitled file is in same dir as workspace root */
                filePath = join(vscodeUtils.getCurrentWorkspaceFolder(false), this.pythonEditorDoc.fileName)
            }
            else{
                filePath = this.pythonEditorDoc.fileName
            }

            try {
                var curline = this.pythonEditor.visibleRanges[0].start.line;
                this.previewContainer.pythonPanelPreview.startrange = curline;
                const codeRan = this.tolivecodeLogic.onUserInput(text, filePath, vscodeUtils.eol(event), settings().get<boolean>('showGlobalVars'))
                if(codeRan) {
                     this.runningStatus.show();
                    



                    }

            } catch (error) {
                if(error instanceof Error){
                    if(error.message == "unsafeKeyword"){
                        const unsafeKeywords = settings().get<string[]>('unsafeKeywords')
                        this.previewContainer.updateError(null, `unsafe keyword detected. 
Doing irreversible operations like deleting folders is very dangerous in a live editor. 
If you want to continue please clear livecode2.unsafeKeywords setting. 
Currently livecode2.unsafeKeywords is set to ["${unsafeKeywords.join('", "')}"]`, true)
                        return
                    }
                    else{
                        console.error(error)
                        this.reporter.sendError(error)
                        this.previewContainer.updateError(null, `internal livecode error: ${error.name} stack: ${error.stack}`, true) 
                    }
                }
                throw error;
            }
        }        
    }
    private runSpaceTracerForDoc(doc: vscode.TextDocument){
        if(!this.pythonEditorDoc || doc !== this.pythonEditorDoc) return

        const text = doc.getText()

        let filePath = ""
        if(doc.isUntitled){
            /* user would assume untitled file is in same dir as workspace root */
            filePath = join(vscodeUtils.getCurrentWorkspaceFolder(false), doc.fileName)
        }
        else{
            filePath = doc.fileName
        }

        const curline = this.pythonEditor?.visibleRanges[0]?.start.line ?? 0;
        this.previewContainer.pythonPanelPreview.startrange = curline;
        this.runningStatus.text = "Running space_tracer..."
        this.runningStatus.show();
        this.runSpaceTracer(text, filePath)
    }
}
