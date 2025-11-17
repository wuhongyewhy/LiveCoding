## 简介 / Introduction

**livecode2 for Python** 是一个 VS Code 扩展，基于 `space_tracer` 实现“所写即所见”的 Python 运行体验。你只需在编辑器中输入代码，Livecode2 就会自动触发 `space_tracer`，把每一行、每一次循环迭代的值变化、异常信息实时渲染在面板中，帮助你快速理解程序行为。

![demo gif](https://raw.githubusercontent.com/wuhongyewhy/LiveCode/master/livecode_example.png)

---

## 主要功能 / Key Features

- **实时执行 / Live execution**：根据 `afterDelay`、`onSave`、`onKeybinding` 等策略自动运行当前脚本。
- **变量与循环可视化 / Variable & loop tracing**：每次赋值、循环迭代的轨迹都会显示在 webview 中。
- **错误即时反馈 / Instant diagnostics**：语法错误与异常堆栈同步呈现，并在编辑器内联提示。
- **灵活配置 / Highly configurable**：延迟、默认导入、变量过滤、结果展示位置等都可定制。

---

## Python 版本要求 / Python Version Requirement

- **最低版本 / Minimum**：Python 3.5。
- **推荐 / Recommended**：Python 3.8 及以上。

Livecode2 会按照以下顺序自动寻找可用的 Python 解释器：

1. 当前激活环境：`PYTHON_EXECUTABLE`、`VIRTUAL_ENV`、`CONDA_PREFIX`、VS Code Python 扩展的 `python.defaultInterpreterPath` 等。
2. 扩展目录自带的 `python/` 文件夹，或者 `livecode2.pythonPath` 设置中显式指定的路径（支持 `${workspaceFolder}` 宏）。
3. 系统 PATH 中的 Python（`PythonShell.defaultPythonPath` 对应的平台默认命令）。

若所有候选均失败，界面会提示“无法找到 Python”，此时请安装 Python 或在设置中指定路径。

---

## 配置指南 / Configuration Guide

| 设置键 Key                                                                   | 说明 Description                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `livecode2.whenToExecute`, `livecode2.delay`, `livecode2.restartDelay` | 控制实时执行的触发策略与延迟。                          |
| `livecode2.pythonPath`, `livecode2.envFile`                              | 手动指定解释器路径与 .env 文件，优先级高于全局 Python。 |
| `livecode2.defaultImports`                                                 | 新会话启动时自动插入的 import 列表。                    |
| `livecode2.printResultPlacement`, `livecode2.show*`                      | 控制结果显示位置、变量过滤、语法/名称错误提示。         |

更多选项请在 VS Code 设置中搜索 `livecode2`。

---

## 快速开始 / Getting Started

1. 安装 Python ≥3.5，并通过 `pip install space-tracer` 获取依赖。
2. 在 VS Code 中安装 livecode2（Marketplace 或 VSIX）。
3. 打开 `.py` 文件 → 运行命令 “Livecode2: eval python in real time” 或使用快捷键：
   - Windows/Linux：`Ctrl+Shift+A`（当前文档）、`Ctrl+Shift+Q`（新会话）
   - macOS：`Cmd+Shift+A`、`Cmd+Shift+R`
4. 根据需要调整 `afterDelay`、`onSave` 等触发方式，或修改 `livecode2.pythonPath`。

### 特殊指令 / Special Markers

- `#$save`：跳过后续代码的实时执行，适合长耗时或有副作用的片段。
- `#$end`：标记实时执行区域的终点，之后的代码仅在手动触发时运行。
- `Ctrl+Enter` /`Cmd+Enter`：在任意位置运行当前代码块。

---

## 英文版 README / English README

### Overview

Livecode2 for Python brings live coding to VS Code through `space_tracer`. It evaluates the current buffer whenever you type, visualize state changes, and shows errors immediately.

### Features

- Live execution with configurable triggers.
- Rich variable & loop tracing in the webview plus inline diagnostics.
- Flexible filtering, display placement, and shortcut-driven workflows.

### Python Requirement & Interpreter Discovery

- Python ≥3.5 (3.8+ recommended).
- Interpreter order: active environment → bundled/`livecode2.pythonPath` → global fallback.
- Errors are surfaced if no interpreter can be found.

### Configuration Cheat Sheet

| Setting                                                 | Purpose                                        |
| ------------------------------------------------------- | ---------------------------------------------- |
| `livecode2.whenToExecute`, `livecode2.delay`        | Debounce & trigger strategy.                   |
| `livecode2.pythonPath`, `livecode2.envFile`         | Override interpreter / .env location.          |
| `livecode2.defaultImports`                            | Inject imports automatically.                  |
| `livecode2.printResultPlacement`, `livecode2.show*` | Control UI layout, filtering, and diagnostics. |

### Getting Started

1. Install Python and `space-tracer`.
2. Install the extension from VSIX or Marketplace.
3. Open any `.py` file, run the `Livecode2` command, and tweak settings to suit your workflow.
4. Use the same special markers (`#$save`,`#$end`) and shortcuts (`Ctrl+Enter` /`Cmd+Enter`).

---

## 致谢 / Credits

- **Livecode for Python**：最初版本来自这个扩展，感谢其创新与开源。
- **wolf 项目**：其在 live coding 方向上的探索启发了我们的设计。
- **PyCharm Live Coding for Python 插件**：提供了交互与 UX 层面的灵感。
- 以及 `space_tracer`、`python-shell`、VS Code 团队等所有上游项目的贡献。

## ☕ [Coffee via PayPal](https://paypal.me/wuhongyewhy)
💚 微信请我喝咖啡：

![](weixin2.png)
