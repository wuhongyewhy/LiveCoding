import {workspace} from "vscode"

/**
 * simple alias for workspace.getConfiguration("livecode2")
 */
export function settings(){
    return workspace.getConfiguration("livecode2")
}
