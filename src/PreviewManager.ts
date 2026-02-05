"use strict"
import livecode2Utils from "./livecodeUtilities"
import * as vscode from "vscode"
import { EnvironmentVariablesProvider } from "./env/variables/environmentVariablesProvider"
import { EnvironmentVariablesService } from "./env/variables/environment"
import { join, basename, dirname } from "path";
import { spawn, ChildProcess } from "child_process"
import { PreviewContainer } from "./previewContainer"
import Reporter from "./telemetry"
import { PythonShell } from "python-shell"
import { settings } from "./settings"
import printDir from "./printDir";
import { PlatformService } from "./env/platform/platformService"
import { PathUtils } from "./env/platform/pathUtils"
import vscodeUtils from "./vscodeUtilities"
import { WorkspaceService } from "./env/application/workspace"
import { Position, Range } from "vscode"
// fs/os 已不再需要（不再通过 sitecustomize 注入）

/**
 * class with logic for starting live-coding and its preview
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
    private spaceTracerChecked = false
    private spaceTracerAvailable = false
    private installingSpaceTracer = false

    /**
     * assumes a text editor is already open - if not will error out
     */
    constructor(context: vscode.ExtensionContext) {
        this.runningStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.runningStatus.text = "Running python..."
        this.runningStatus.tooltip = "live-coding is currently running your python file. Close the live-coding preview to stop"
        this.reporter = new Reporter(settings().get<boolean>("telemetry"))
        this.previewContainer = new PreviewContainer(this.reporter, context)

        this.highlightDecorationType = vscode.window.createTextEditorDecorationType(<vscode.ThemableDecorationRenderOptions>{
            backgroundColor: 'yellow'
        })
    }

    async loadAndWatchEnvVars() {
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

    async startlivecode() {
        // see https://github.com/Microsoft/vscode/issues/46445
        vscode.commands.executeCommand("setContext", "live-coding", true)

        // reload reporter (its disposed when live-coding is closed)
        this.reporter = new Reporter(settings().get<boolean>("telemetry"))

        if (!vscode.window.activeTextEditor) {
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
        panel.onDidDispose(() => this.dispose(), this, this.subscriptions)
        this.subscriptions.push(panel)

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg?.command === "install-space-tracer") {
                await this.installSpaceTracer();
            }
        }, undefined, this.subscriptions)

        // only space_tracer is used now – no AREPL backend startup

        if (this.pythonEditorDoc.isUntitled && this.pythonEditorDoc.getText() == "") {
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

        var lastline_text = this.pythonEditorDoc.lineAt(lc - 1)

        var lastline_end = lastline_text.text.length

        if (lc > 1 || lastline_end > 0) {
            this.pythonEditor.edit((builder) => {
                builder.insert(new vscode.Position(lc - 1, lastline_end), "\n");
            }).then((success) => {
                if (success) {
                    this.pythonEditor.edit((builder) => {
                        const newLc = this.pythonEditorDoc.lineCount;
                        builder.delete(new vscode.Range(new vscode.Position(lc - 1, lastline_end), new vscode.Position(newLc - 1, 0)));
                    });
                }
            });
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

    runlivecode() {
        if (this.pythonEditorDoc) {
            void this.runSpaceTracerForDoc(this.pythonEditorDoc)
        }
    }

    /**
     * adds print() or print(dir()) if line ends in .
     * ex: x=1; print(x)
     * Then runs it
     */
    printDir() {

        if (this.pythonEditor != vscode.window.activeTextEditor) return
        const selection = this.pythonEditor.selection
        if (!selection.isSingleLine) return
        let codeLines = this.pythonEditor.document.getText()

        let codeLinesArr = printDir(codeLines.split(vscodeUtils.eol(this.pythonEditor.document)), selection.start.line)
        // todo: how to connect this with onAnyDocChange?
    }

    runlivecodeBlock() {
        if (this.pythonEditorDoc) {
            void this.runSpaceTracerForDoc(this.pythonEditorDoc)
        }
    }

    dispose() {
        vscode.commands.executeCommand("setContext", "live-coding", false)

        this.disposable = vscode.Disposable.from(...this.subscriptions);
        this.disposable.dispose();

        this.runningStatus.dispose();

        this.reporter.sendFinishedEvent(settings())
        this.reporter.dispose();

        if (vscode.window.activeTextEditor) {
            vscode.window.activeTextEditor.setDecorations(this.previewContainer.errorDecorationType, [])
        }
    }

    /**
     * show err message to user if outdated version of python
     */
    private warnIfOutdatedPythonVersion(pythonPath: string) {
        PythonShell.getVersion(`"${pythonPath}"`).then((out) => {
            let version = out.stdout ? out.stdout : out.stderr
            if (version?.includes("Python 3.4") || version?.includes("Python 2")) {
                vscode.window.showErrorMessage(`live-coding does not support ${version}.
                Please upgrade or set live-coding.pythonPath to a diffent python.
                live-coding needs python 3.5 or greater`)
            }
            if (version) {
                this.reporter.pythonVersion = version.trim()
            }
        }).catch((err: NodeJS.ErrnoException) => {
            // if we get spawn error here thats already reported by telemetry
            // so we skip telemetry reporting for this error
            console.error(err)
            if (err.message.includes("Python was not found but can be installed from the Microsoft Store")) {
                vscode.window.showErrorMessage(err.message)
            }
        })
    }

    private ensureSpaceTracerAvailable(pythonPath: string): Promise<boolean> {
        if (this.spaceTracerChecked && this.spaceTracerAvailable) return Promise.resolve(true)
        if (this.installingSpaceTracer) return Promise.resolve(false)

        return new Promise<boolean>((resolve) => {
            const checkProc = spawn(pythonPath, ["-c", "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('space_tracer') else 1)"], {
                env: process.env,
                stdio: "ignore"
            })

            checkProc.on("close", (code) => {
                this.spaceTracerChecked = true
                this.spaceTracerAvailable = code === 0
                if (!this.spaceTracerAvailable) {
                    this.previewContainer.pythonPanelPreview.showSpaceTracerInstallPrompt(
                        `未检测到 space_tracer。点击下方按钮使用当前 Python (${pythonPath}) 安装。`
                    )
                }
                resolve(this.spaceTracerAvailable)
            })

            checkProc.on("error", () => {
                this.spaceTracerChecked = true
                this.spaceTracerAvailable = false
                this.previewContainer.pythonPanelPreview.showSpaceTracerInstallPrompt(
                    `无法检测 space_tracer（无法运行 ${pythonPath}）。请确认 Python 路径有效。`
                )
                resolve(false)
            })
        })
    }

    private async installSpaceTracer() {
        if (this.installingSpaceTracer) return
        const pythonPath = livecode2Utils.getPythonPath()
        this.installingSpaceTracer = true
        this.runningStatus.text = "Installing space_tracer..."
        this.runningStatus.show()
        this.previewContainer.showTrace("正在安装 space_tracer ...", "", "")

        await new Promise<void>((resolve) => {
            const proc = spawn(pythonPath, ["-m", "pip", "install", "space_tracer"], {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"]
            })

            let stdout = ""
            let stderr = ""

            proc.stdout?.on("data", data => stdout += data.toString())
            proc.stderr?.on("data", data => stderr += data.toString())

            proc.on("close", async (code) => {
                this.installingSpaceTracer = false
                this.runningStatus.hide()
                if (code === 0) {
                    this.spaceTracerChecked = true
                    this.spaceTracerAvailable = true
                    this.previewContainer.showTrace("space_tracer 安装完成，正在重新运行…", "", pythonPath)
                    if (this.pythonEditorDoc) {
                        await this.runSpaceTracerForDoc(this.pythonEditorDoc)
                    }
                } else {
                    const msg = [stdout, stderr].filter(Boolean).join("\n").trim() || `pip 退出码 ${code}`
                    this.previewContainer.showTrace(`space_tracer 安装失败：\n${msg}`, "", "")
                }
                resolve()
            })

            proc.on("error", err => {
                this.installingSpaceTracer = false
                this.runningStatus.hide()
                this.previewContainer.showTrace(`启动 pip 失败：${err instanceof Error ? err.message : String(err)}`, "", "")
                resolve()
            })
        })
    }

    /**
     * 以“纯代码模式”运行 space_tracer：
     * - 不创建任何 turtle 画布
     * - 只使用 space_tracer 的文本 trace 能力
     */
    private runSpaceTracer(pythonPath: string, sourceCode: string, filePath: string) {
        const workspaceFolder = vscodeUtils.getCurrentWorkspaceFolder(false) || undefined

        // 如已有正在运行的 trace 进程，先终止
        if (this.traceProcess) {
            try {
                this.traceProcess.kill()
            } catch { }
            this.traceProcess = null
        }

        // 通过内联脚本调用 TraceRunner.trace_code，并在脚本内部把 MockTurtle 的
        // monkey_patch/remove_monkey_patch 替换为 no-op，彻底关闭画图逻辑。
        // 同时强制重置 stdin/stdout/stderr 为 utf-8 编码，避免 Windows 默认 GBK 导致乱码
        const driver = [
            "import sys",
            "import io",
            "try:",
            "    # 强制重置标准流为 utf-8",
            "    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')",
            "    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')",
            "    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')",
            "except Exception:",
            "    pass",
            "",
            "try:",
            "    from space_tracer.main import TraceRunner",
            "    try:",
            "        from space_tracer import mock_turtle as mt",
            "",
            "        def _lc_noop_monkey_patch(*args, **kwargs):",
            "            # live-coding: disable MockTurtle to avoid GUI requirements",
            "            return",
            "",
            "        def _lc_noop_remove_monkey_patch(*args, **kwargs):",
            "            # live-coding: no-op cleanup",
            "            return",
            "",
            "        mt.MockTurtle.monkey_patch = _lc_noop_monkey_patch",
            "        mt.MockTurtle.remove_monkey_patch = _lc_noop_remove_monkey_patch",
            "    except Exception:",
            "        # 如果 mock_turtle 不存在，忽略即可（只做文本 trace）",
            "        pass",
            "",
            "    code = sys.stdin.read()",
            "    runner = TraceRunner()",
            "    report = runner.trace_code(code)",
            "    if report is None:",
            "        report = ''",
            "    sys.stdout.write(report)",
            "except Exception as e:",
            "    # 将异常写入 stderr，方便上层展示",
            "    sys.stderr.write(str(e))",
            ""
        ].join("\n")

        const args = ["-u", "-c", driver]
        const cwd = workspaceFolder || (filePath ? dirname(filePath) : undefined)
        const env = Object.assign({}, process.env, { PYTHONIOENCODING: "utf-8" })

        const proc = spawn(pythonPath, args, {
            cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"]
        })
        this.traceProcess = proc

        if (proc.stdin) {
            proc.stdin.write(sourceCode)
            proc.stdin.end()
        }

        let stdout = ""
        let stderr = ""

        proc.stdout.on("data", data => {
            stdout += data.toString()
        })
        proc.stderr.on("data", data => {
            stderr += data.toString()
        })

        proc.on("close", code => {
            if (this.traceProcess !== proc) return  // newer run started
            this.traceProcess = null
            this.runningStatus.hide()

            if (code === 0) {
                this.previewContainer.showTrace(stdout || "(space_tracer 没有输出)", sourceCode, pythonPath)
            } else {
                const combined = [stdout, stderr].filter(Boolean).join("\n").trim()
                const msg = combined || `space_tracer 退出码: ${code}`
                this.previewContainer.showTrace(msg, "", "")
            }
        })

        proc.on("error", err => {
            const msg = err instanceof Error ? err.message : String(err)
            this.runningStatus.hide()
            this.previewContainer.showTrace(`启动 space_tracer 失败: ${msg}`, "", "")
        })
    }

    private change_line_view() {
        const editor = vscode.window.activeTextEditor
        if (!editor || editor.visibleRanges.length === 0) return
        const panel = this.previewContainer?.pythonPanelPreview?.panel
        if (!panel || panel.webview === undefined) return

        const curline = editor.visibleRanges[0].start.line
        panel.webview.postMessage({ line: curline })
    }
    // legacy AREPL backend startup removed – live-coding now uses space_tracer only

    /**
     * binds various funcs to activate upon edit of document / switching of active doc / etc...
     */
    private subscribeHandlersToDoc() {

        if (settings().get<boolean>("skipLandingPage")) {
            if (this.pythonEditorDoc) {
                void this.runSpaceTracerForDoc(this.pythonEditorDoc)
            }
        }


        vscode.workspace.onDidSaveTextDocument((e) => {
            if (settings().get<string>("whenToExecute") == "onSave") {
                void this.runSpaceTracerForDoc(e)
            }
        }, this, this.subscriptions)

        vscode.workspace.onDidChangeTextDocument((e) => {
            const cachedSettings = settings()
            if (cachedSettings.get<string>("whenToExecute") == "afterDelay") {
                let delay = cachedSettings.get<number>("delay");
                if (this.changeTimer) {
                    clearTimeout(this.changeTimer)
                }
                this.changeTimer = setTimeout(() => {
                    void this.runSpaceTracerForDoc(e.document)
                }, delay)
            }
        }, this, this.subscriptions)



        vscode.window.onDidChangeTextEditorVisibleRanges((event) => {


            this.change_line_view();


        }, this, this.subscriptions)












        vscode.workspace.onDidCloseTextDocument((e) => {
            if (e == this.pythonEditorDoc) this.dispose()
        }, this, this.subscriptions)









    }


    private onAnyDocChange(event: vscode.TextDocument) {
        if (event == this.pythonEditorDoc) {

            this.reporter.numRuns += 1

            const text = event.getText()

            let filePath = ""
            if (this.pythonEditorDoc.isUntitled) {
                /* user would assume untitled file is in same dir as workspace root */
                filePath = join(vscodeUtils.getCurrentWorkspaceFolder(false), this.pythonEditorDoc.fileName)
            }
            else {
                filePath = this.pythonEditorDoc.fileName
            }

            try {
                var curline = this.pythonEditor.visibleRanges[0].start.line;
                this.previewContainer.pythonPanelPreview.startrange = curline;
                const codeRan = this.tolivecodeLogic.onUserInput(text, filePath, vscodeUtils.eol(event), settings().get<boolean>('showGlobalVars'))
                if (codeRan) {
                    this.runningStatus.show();




                }

            } catch (error) {
                if (error instanceof Error) {
                    if (error.message == "unsafeKeyword") {
                        const unsafeKeywords = settings().get<string[]>('unsafeKeywords')
                        this.previewContainer.updateError(null, `unsafe keyword detected. 
Doing irreversible operations like deleting folders is very dangerous in a live editor. 
If you want to continue please clear live-coding.unsafeKeywords setting. 
Currently live-coding.unsafeKeywords is set to ["${unsafeKeywords.join('", "')}"]`, true)
                        return
                    }
                    else {
                        console.error(error)
                        this.reporter.sendError(error)
                        this.previewContainer.updateError(null, `internal livecode error: ${error.name} stack: ${error.stack}`, true)
                    }
                }
                throw error;
            }
        }
    }
    private async runSpaceTracerForDoc(doc: vscode.TextDocument) {
        if (!this.pythonEditorDoc || doc !== this.pythonEditorDoc) return

        const text = doc.getText()

        let filePath = ""
        if (doc.isUntitled) {
            /* user would assume untitled file is in same dir as workspace root */
            filePath = join(vscodeUtils.getCurrentWorkspaceFolder(false), doc.fileName)
        }
        else {
            filePath = doc.fileName
        }

        const curline = this.pythonEditor?.visibleRanges[0]?.start.line ?? 0;
        this.previewContainer.pythonPanelPreview.startrange = curline;
        this.runningStatus.text = "Running space_tracer..."
        this.runningStatus.show();
        const pythonPath = livecode2Utils.getPythonPath()
        const resolvedPythonPath = livecode2Utils.resolvePythonPath(pythonPath)
        const hasSpaceTracer = await this.ensureSpaceTracerAvailable(resolvedPythonPath)
        if (!hasSpaceTracer) {
            this.runningStatus.hide()
            return
        }
        this.runSpaceTracer(resolvedPythonPath, text, filePath)
    }
}
