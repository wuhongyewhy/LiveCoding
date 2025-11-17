import {workspace} from "vscode"

/**
 * simple alias for workspace.getConfiguration("live-coding")
 */
export function settings(){
    return workspace.getConfiguration("live-coding")
}
