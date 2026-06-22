<div align="center">

<img src="src/res/icon.png" width="120" alt="Clipboard Image to Terminal" />

# Clipboard Image to Terminal

**Paste clipboard images as file paths — built for AI coding tools**

[![npm version](https://img.shields.io/npm/v/clipboard-image-terminal?color=blue)](https://www.npmjs.com/package/clipboard-image-terminal)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/muammar-yacoob.clipboard-image-terminal?color=blue&label=VS%20Code)](https://marketplace.visualstudio.com/items?itemName=muammar-yacoob.clipboard-image-terminal)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/muammar-yacoob.clipboard-image-terminal?color=blue&label=installs)](https://marketplace.visualstudio.com/items?itemName=muammar-yacoob.clipboard-image-terminal)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

</div>

---

AI coding tools (Claude Code, Aider, etc.) can't see an image you copy until it's a file on disk — and on **WSL** the Linux side can't even read the Windows clipboard. This bridges that gap: it grabs the clipboard image, saves it as a **lossless PNG**, and hands you the file path. Cross-platform: **WSL/Windows, macOS, and Linux**.

It ships in two flavours that share the same core:

| | What it does | Best for |
|---|---|---|
| 🧩 **VS Code extension** | `Ctrl+Alt+V` types the image path into the active terminal | Working inside VS Code |
| ⌨️ **CLI** (`clipimg`) | Prints the saved image path to stdout | Any terminal / shell scripts |

## How it works

1. Reads the clipboard image via the host's native tool (PowerShell / osascript / wl-paste / xclip)
2. Saves it as a **lossless PNG** — keeps screenshots of code & text crisp for vision models
3. Stores it in `/tmp/clipboard-images/`, named by content hash (re-pasting the same image is a no-op; files older than 7 days are auto-pruned)
4. Gives you the path — typed into the terminal (extension) or printed to stdout (CLI)

---

## CLI

### Install

```sh
npm install -g clipboard-image-terminal
```

### Usage

```sh
clipimg                       # save clipboard image, print its path
claude "look at $(clipimg)"   # feed the image straight to an AI tool
clipimg -d ./shots            # save into a custom directory
clipimg help                  # show the help screen
```

| Option | Description |
|---|---|
| `-d, --dir <path>` | Output directory (default `/tmp/clipboard-images`) |
| `-v, --version` | Print version |
| `-h, --help` | Show help |

Exits `1` and prints `No image on clipboard` when the clipboard holds no image.

---

## VS Code extension

### Install

Search **"Clipboard Image to Terminal"** in the Extensions panel, or:

```sh
code --install-extension muammar-yacoob.clipboard-image-terminal
```

### Usage

| Shortcut | Context | Action |
|---|---|---|
| `Ctrl+Alt+V` | Terminal focused | Paste clipboard image path |
| Right-click | Terminal | **Paste Clipboard Image to Terminal** |

Rebind via `Preferences: Open Keyboard Shortcuts` → search `clipboard-image.paste`.

### Settings

| Setting | Default | Description |
|---|---|---|
| `clipboardImage.outputDir` | `/tmp/clipboard-images` | Directory to save pasted images |

---

## Requirements

Node.js ≥ 20 (CLI only), plus a clipboard tool for your platform:

| Platform | Tool |
|---|---|
| **WSL / Windows** | `powershell.exe` (default on all installs) |
| **macOS** | `osascript` (built-in), or [`pngpaste`](https://github.com/jcsalterego/pngpaste) |
| **Linux** | `wl-clipboard` (Wayland) or `xclip` (X11) |

## Development

```sh
bun install
bun run build          # compile TypeScript → out/
node out/cli.js help   # try the CLI locally
# Press F5 in VS Code to launch the extension in a dev host
```

| Script | Action |
|---|---|
| `bun run build` | Compile with `tsc` |
| `bun run package` | Build + `vsce package` (.vsix) |
| `bun run publish:vscode` | Publish to VS Code Marketplace |
| `bun run publish:npm` | Publish the CLI to npm |

## License

MIT
