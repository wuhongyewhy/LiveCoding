import {PythonResult, UserError} from "arepl-backend"
import * as vscode from "vscode"
import PythonInlinePreview from "./pythonInlinePreview"
import PythonPanelPreview from "./pythonPanelPreview"
import Reporter from "./telemetry"
import {settings} from "./settings"

/**
 * logic wrapper around html preview doc
 */
export class PreviewContainer{
    public printResults: string[];
    pythonInlinePreview: PythonInlinePreview
    public errorDecorationType: vscode.TextEditorDecorationType
    private vars: {}
    private activeDocument?: vscode.TextDocument

    constructor(private reporter: Reporter, context: vscode.ExtensionContext, htmlUpdateFrequency=50, public pythonPanelPreview?: PythonPanelPreview){
        if(!this.pythonPanelPreview) this.pythonPanelPreview = new PythonPanelPreview(context, htmlUpdateFrequency)
        this.pythonInlinePreview = new PythonInlinePreview(reporter, context)
        this.errorDecorationType = this.pythonInlinePreview.errorDecorationType
    }

    public start(linkedFileName: string){
        this.clearStoredData()
        return this.pythonPanelPreview.start(linkedFileName)
    }

    public setActiveDocument(doc: vscode.TextDocument){
        this.activeDocument = doc
    }

    /**
     * clears stored data (preview gui is unaffected)
     */
    public clearStoredData(){
        this.vars = {}
        this.printResults = []
    }

    public handleResult(pythonResults: PythonResult){

        console.debug(`Exec time: ${pythonResults.execTime}`)
        console.debug(`Python time: ${pythonResults.totalPyTime}`)
        console.debug(`Total time: ${pythonResults.totalTime}`)

        this.reporter.execTime += pythonResults.execTime
        this.reporter.totalPyTime += pythonResults.totalPyTime
        this.reporter.totalTime += pythonResults.totalTime

        // 使用 space_tracer 时忽略 AREPL 后端的变量结果
        return
    }

    public handlePrint(pythonResults: string){
        // 使用 space_tracer 时忽略 AREPL 后端的普通 print 输出
        return
    }

    public showTrace(trace: string){
        this.pythonPanelPreview.showTrace(trace)
    }

    public updateError(userError: UserError, userErrorMsg: string, refresh: boolean){
        const cachedSettings = settings()
        if(!cachedSettings.get('showNameErrors')){
            if(userError?.exc_type?.["py/type"]?.includes("NameError")){
                console.warn('skipped showing name error - showNameErrors setting is off')
                return
            }
        }
        if(!cachedSettings.get('showSyntaxErrors')){
            if(userError?.exc_type?.["py/type"]?.includes("SyntaxError")){
                console.warn('skipped showing syntax error - SyntaxError setting is off')
                return
            }
        }
        if(cachedSettings.get('inlineResults')){
            this.pythonInlinePreview.showInlineErrors(userError, userErrorMsg)
        }
        this.pythonPanelPreview.updateError(userErrorMsg, refresh)
    }

    public displayProcessError(err: string){
        this.pythonPanelPreview.displayProcessError(err)
    }

    /**
     * user may dump var(s), which we format into readable output for user
     * @param pythonResults result with either "dump output" key or caller and lineno
     */
    private updateVarsWithDumpOutput(pythonResults: PythonResult){
        const lineKey = "line " + pythonResults.lineno
        if(pythonResults.userVariables["dump output"] != undefined){
            const dumpOutput = pythonResults.userVariables["dump output"]
            pythonResults.userVariables = {}
            pythonResults.userVariables[lineKey] = dumpOutput
        }
        else{
            const v = pythonResults.userVariables
            pythonResults.userVariables = {}
            pythonResults.userVariables[pythonResults.caller + " vars " + lineKey] = v
        }
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this.pythonPanelPreview.onDidChange
    }

    private buildPreviewVariables(vars: {[key: string]: any}){
        const abcdict: {[key: number]: object[]} & { nlines?: number } = {}
        const handledKeys = new Set<string>()
        const doc = this.activeDocument
        const lineAssignments = this.mapVariablesToLines(doc)

        const lineMatch = /(line\s+(\d+))/i
        Object.entries(vars).forEach(([key, value])=>{
            const match = key.match(lineMatch)
            if(match){
                handledKeys.add(key)
                const lineIndex = Math.max(parseInt(match[2], 10) - 1, 0)
                const stripped = key.replace(lineMatch, "").trim()
                const label = stripped.length > 0 ? stripped : key
                this.addEntryToLine(abcdict, lineIndex, {[label]: value})
            }
        })

        const fallbackLine = this.getFallbackLine(doc)
        Object.entries(vars).forEach(([name, value])=>{
            if(handledKeys.has(name)) return
            const assignedLine = lineAssignments.get(name)
            const targetLine = typeof assignedLine === "number" ? assignedLine : fallbackLine
            this.addEntryToLine(abcdict, targetLine, {[name]: value})
        })

        const totalLines = this.getDocumentLineCount(doc, abcdict)
        abcdict["nlines"] = totalLines > 0 ? totalLines - 1 : 0

        return {
            abcdict,
            rawVariables: vars
        }
    }

    private addEntryToLine(abcdict: {[key: number]: object[]} & { nlines?: number }, lineIndex: number, entry: object){
        if(lineIndex == null || !isFinite(lineIndex) || lineIndex < 0) lineIndex = 0
        if(!abcdict[lineIndex]) abcdict[lineIndex] = []
        abcdict[lineIndex].push(entry)
    }

    private getDocumentLineCount(doc?: vscode.TextDocument | null, abcdict?: {[key: number]: object[]}){
        if(doc) return doc.lineCount
        if(!abcdict) return 0
        const numericKeys = Object.keys(abcdict)
            .map(k => Number(k))
            .filter(k => !isNaN(k))
        if(numericKeys.length === 0) return 0
        return Math.max(...numericKeys) + 1
    }

    private mapVariablesToLines(doc?: vscode.TextDocument | null){
        const assignments = new Map<string, number>()
        if(!doc) return assignments

        const assignmentRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\]\s*)?(?:\+=|-=|\*=|\/=|\/\/=|%=|\*\*=|=)(?!=)/g
        const forLoopRegex = /\bfor\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\b/g

        for(let i=0; i<doc.lineCount; i++){
            const text = doc.lineAt(i).text
            let match: RegExpExecArray | null

            assignmentRegex.lastIndex = 0
            while((match = assignmentRegex.exec(text)) !== null){
                const name = match[1]
                if(!assignments.has(name)) assignments.set(name, i)
            }

            forLoopRegex.lastIndex = 0
            while((match = forLoopRegex.exec(text)) !== null){
                const names = match[1].split(",").map(n => n.trim()).filter(Boolean)
                names.forEach(name => {
                    if(!assignments.has(name)) assignments.set(name, i)
                })
            }
        }

        return assignments
    }

    private getFallbackLine(doc?: vscode.TextDocument | null){
        if(doc && doc.lineCount > 0) return doc.lineCount - 1
        return 0
    }
}
