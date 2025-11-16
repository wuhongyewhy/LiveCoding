import { WorkspaceConfiguration } from "vscode";
import { userInfo } from "os";
import { sep } from "path";
import livecode2Utils from "./livecodeUtilities";

export default class Reporter{
    private reporterEnabled: boolean
    private timeOpened: number
    private lastStackTrace: string
    numRuns: number
    numInterruptedRuns: number
    execTime: number
    totalPyTime: number
    totalTime: number
    pythonVersion: string

    constructor(private enabled: boolean){
        this.reporterEnabled = enabled;
        this.resetMeasurements()
    }

    sendError(error: Error, code: number = 0, category='typescript'){
        console.error(`${category} error: ${error.name} code ${code}\n${error.stack}`)
        if(this.enabled && this.reporterEnabled){

            error.stack = this.anonymizePaths(error.stack)
            
            // no point in sending same error twice
            if(error.stack == this.lastStackTrace) return

            this.lastStackTrace = error.stack
        }
    }

    /**
     * sends various stats to azure app insights
     */
    sendFinishedEvent(settings: WorkspaceConfiguration){
        if(this.enabled && this.reporterEnabled){
            const measurements: {[key: string]: number} = {}
            measurements['timeSpent'] = (Date.now() - this.timeOpened)/1000
            measurements['numRuns'] = this.numRuns
            measurements['numInterruptedRuns'] = this.numInterruptedRuns

            if(this.numRuns != 0){
                measurements['execTime'] = this.execTime / this.numRuns
                measurements['totalPyTime'] = this.totalPyTime / this.numRuns
                measurements['totalTime'] = this.totalTime / this.numRuns
            }
            else{ // lets avoid 0/0 NaN error
                measurements['execTime'] = 0
                measurements['totalPyTime'] = 0
                measurements['totalTime'] = 0
            }

            const properties: {[key: string]: string} = {}

            // no idea why I did this but i think there was a reason?
            // this is why you leave comments people
            const settingsDict = JSON.parse(JSON.stringify(settings))            
            for(let key in settingsDict){
                properties[key] = settingsDict[key]
            }
            
            properties['pythonPath'] = this.anonymizePaths(livecode2Utils.getPythonPath())
            properties['pythonVersion'] = this.pythonVersion

            this.resetMeasurements()
        }
    }

    private resetMeasurements(){
        this.timeOpened = Date.now()

        this.numRuns = 0
        this.numInterruptedRuns = 0
        this.execTime = 0
        this.totalPyTime = 0
        this.totalTime = 0
    }

    /**
     * replace username with anon
     */
    anonymizePaths(input: string){
        if(input == null) return input
        return input.replace(new RegExp('\\'+sep+userInfo().username, 'g'), sep+'anon')
    }

    dispose(){}
}
