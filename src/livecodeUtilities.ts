"use strict"
import * as vscode from "vscode";
import { EOL } from "os"
import { settings } from "./settings"
import { PythonShell } from "python-shell";
import vscodeUtils from "./vscodeUtilities"
import * as fs from "fs"
import * as path from "path"
import { spawnSync } from "child_process"

/**
 * utilities specific to live-coding
 */
export default class livecode2Utils {

    static getEnvFilePath() {
        let envFilePath = vscodeUtils.getSettingOrOtherExtSettingAsDefault<string>("live-coding", "python", "envFile")

        if (!envFilePath) envFilePath = "${workspaceFolder}/.env"

        return vscodeUtils.expandPathSetting(envFilePath)
    }

    static getPythonPath() {
        const candidates: Array<string | undefined> = [
            // 1. 当前激活环境：显式变量、虚拟环境、Conda、官方 Python 插件
            ...livecode2Utils.getEnvironmentPythonCandidates(),
            livecode2Utils.getPythonExtensionInterpreter(),
            // 2. 扩展目录自带或 live-coding.pythonPath
            livecode2Utils.getBundledPythonPath(),
            livecode2Utils.getConfiguredPythonPath(),
            // 3. 系统全局 python
            PythonShell.defaultPythonPath
        ]

        const seen = new Set<string>()
        for (const candidate of candidates) {
            const normalized = livecode2Utils.normalizePythonCandidate(candidate)
            if (!normalized) continue
            const key = normalized.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            if (livecode2Utils.isUsablePython(normalized)) {
                return normalized
            }
        }

        return "python"
    }

    private static getEnvironmentPythonCandidates(): string[] {
        const envCandidates: string[] = []
        const explicit = process.env.PYTHON_EXECUTABLE
        if (explicit) envCandidates.push(explicit)

        const conda = process.env.CONDA_PREFIX
        if (conda) envCandidates.push(...livecode2Utils.getInterpreterFromHome(conda))

        const venv = process.env.VIRTUAL_ENV
        if (venv) envCandidates.push(...livecode2Utils.getInterpreterFromHome(venv))

        const pyHome = process.env.PYTHON_HOME
        if (pyHome) envCandidates.push(...livecode2Utils.getInterpreterFromHome(pyHome))

        return envCandidates
    }

    private static getInterpreterFromHome(home: string): string[] {
        const scriptsFolder = process.platform === "win32" ? "Scripts" : "bin"
        const executables = process.platform === "win32"
            ? ["python.exe", "python3.exe", "pythonw.exe"]
            : ["python3", "python"]
        const candidates: string[] = []
        for (const execName of executables) {
            candidates.push(path.join(home, execName))
            candidates.push(path.join(home, scriptsFolder, execName))
        }
        return candidates
    }

    private static getPythonExtensionInterpreter(): string | undefined {
        const pythonSettings = vscode.workspace.getConfiguration("python", vscodeUtils.getCurrentWorkspaceFolderUri())
        return pythonSettings.get<string>("defaultInterpreterPath") ||
            pythonSettings.get<string>("pythonPath") ||
            undefined
    }

    private static getConfiguredPythonPath(): string | undefined {
        const configured = settings().get<string>("pythonPath")
        if (!configured) return undefined
        return vscodeUtils.expandPathSetting(configured)
    }

    private static getBundledPythonPath(): string | undefined {
        const extension = vscode.extensions.getExtension("wuhy.live-coding")
        if (!extension) return undefined
        const root = extension.extensionPath
        const relPaths = process.platform === "win32"
            ? ["python\\python.exe", "python\\Scripts\\python.exe"]
            : ["python/bin/python3", "python/bin/python"]
        for (const rel of relPaths) {
            const abs = path.join(root, rel)
            if (fs.existsSync(abs)) {
                return abs
            }
        }
        return undefined
    }

    private static normalizePythonCandidate(candidate?: string): string | undefined {
        if (!candidate) return undefined
        if (candidate.includes("${")) {
            return vscodeUtils.expandPathSetting(candidate)
        }
        return candidate
    }

    private static isUsablePython(candidate: string): boolean {
        if (!candidate) return false
        if (path.isAbsolute(candidate)) {
            return fs.existsSync(candidate)
        }
        const detector = process.platform === "win32" ? "where" : "which"
        const result = spawnSync(detector, [candidate], { stdio: "ignore" })
        return result.status === 0
    }

    static insertDefaultImports(editor: vscode.TextEditor) {
        return editor.edit((editBuilder) => {
            let imports = settings().get<string[]>("defaultImports")

            imports = imports.filter(i => i.trim() != "")
            if (imports.length == 0) return

            imports = imports.map(i => {
                const words = i.split(" ")

                // python import syntax: "import library" or "from library import method"
                // so if user didnt specify import we will do that for them :)
                if (words[0] != "import" && words[0] != "from" && words[0].length > 0) {
                    i = "import " + i
                }

                return i
            })

            editBuilder.insert(new vscode.Position(0, 0), imports.join(EOL) + EOL)
        })
    }

    static resolvePythonPath(pythonPath: string): string {
        let resolvedPath = pythonPath;
        if (!path.isAbsolute(pythonPath)) {
            const detector = process.platform === "win32" ? "where" : "which";
            try {
                const result = spawnSync(detector, [pythonPath], { encoding: "utf-8" });
                if (result.status === 0 && result.stdout) {
                    const lines = result.stdout.split(/\r?\n/);
                    if (lines.length > 0 && lines[0].trim() !== "") {
                        resolvedPath = lines[0].trim();
                    }
                }
            } catch (e) {
                console.error("Failed to resolve python path", e);
            }
        }

        // If it's py.exe (or just py on windows), we need to ask it where the real python is
        if (process.platform === "win32" && (path.basename(resolvedPath).toLowerCase() === "py.exe" || path.basename(resolvedPath).toLowerCase() === "py")) {
            try {
                const result = spawnSync(resolvedPath, ["-c", "import sys; print(sys.executable)"], { encoding: "utf-8" });
                if (result.status === 0 && result.stdout) {
                    const realPath = result.stdout.trim();
                    if (realPath) {
                        return realPath;
                    }
                }
            } catch (e) {
                console.error("Failed to resolve real python path from py.exe", e);
            }
        }

        return resolvedPath;
    }

}
