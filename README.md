[//]: # (Constants)
[coffee-link]: https://buymeacoffee.com/spark88
[website-link]: https://spark-games.co.uk
[issues-link]: ../../issues
[release-link]: ../../releases
[fork-link]: ../../fork
[license-link]: ./LICENSE
[privacy-link]: ./PRIVACY.md
[marketplace-link]: https://marketplace.visualstudio.com/items?itemName=muammar-yacoob.clipboard-image-terminal
[npm-link]: https://www.npmjs.com/package/clipboard-image-terminal

<div align="center">
  <img src="src/res/icon.png" width="140" alt="Clipboard Image to Terminal logo">

  <h1>Clipboard Image to Terminal</h1>

  <h3>Paste clipboard images as file paths — built for AI coding tools</h3>

  [![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/muammar-yacoob.clipboard-image-terminal?logo=visualstudiocode&logoColor=white&label=VS%20Code&color=blue)][marketplace-link]
  [![npm](https://img.shields.io/npm/v/clipboard-image-terminal?logo=npm&logoColor=white&color=red)][npm-link]
  [![Installs](https://img.shields.io/visual-studio-marketplace/i/muammar-yacoob.clipboard-image-terminal?logo=visualstudiocode&logoColor=white&label=installs&color=blue)][marketplace-link]
  [![Buy Me Coffee](https://img.shields.io/badge/Buy%20Me-Coffee-green?logo=buy-me-a-coffee&logoColor=white)][coffee-link]
  [![Report Bug](https://img.shields.io/badge/Report-Bug-red?logo=github&logoColor=white)][issues-link]
  [![GitHub Stars](https://img.shields.io/github/stars/muammar-yacoob/clipboard-image-terminal?style=social)](../../stargazers)
</div>

---

AI coding tools (Claude Code, Aider, etc.) can't see an image you copy until it's a file on disk — and on **WSL** the Linux side can't even read the Windows clipboard. This bridges that gap: it grabs the clipboard image, saves it as a **lossless PNG**, and hands you the file path.

Works on **WSL/Windows, macOS, and Linux**, and ships in two flavours that share one core:

| | What it does | Best for |
|---|---|---|
| 🧩 **VS Code extension** | `Ctrl+Alt+V` types the image path into the active terminal | Working inside VS Code |
| ⌨️ **CLI** (`clipimg`) | Prints the saved image path to stdout | Any terminal / shell scripts |

## 📥 Installation

**VS Code extension**

Search **"Clipboard Image to Terminal"** in the Extensions panel, or:

```sh
code --install-extension muammar-yacoob.clipboard-image-terminal
```

**CLI**

```sh
npm install -g clipboard-image-terminal
```

## 🚀 Quick Start

Copy any image, then:

```sh
clipimg                       # save clipboard image, print its path
claude "look at $(clipimg)"   # feed the image straight to an AI tool
clipimg -d ./shots            # save into a custom directory
clipimg help                  # show the help screen
```

Inside VS Code, just focus the terminal and press **`Ctrl+Alt+V`** (or right-click → **Paste Clipboard Image to Terminal**).

## ✨ Features

- **Lossless PNG** — keeps screenshots of code & text crisp for vision models
- **Cross-platform** — WSL/Windows, macOS, and Linux, each via its native clipboard tool
- **Pipeable** — the CLI prints just the path to stdout, perfect for `$(clipimg)`
- **De-duplicated** — images are named by content hash, so re-pasting the same image is a no-op
- **Self-cleaning** — saved images older than 7 days are pruned automatically
- **Configurable output directory** — `-d` flag (CLI) or a VS Code setting

### ⌨️ CLI options

| Option | Description |
|---|---|
| `-d, --dir <path>` | Output directory (default `/tmp/clipboard-images`) |
| `-v, --version` | Print version |
| `-h, --help` | Show help |

Exits `1` and prints `No image on clipboard` when the clipboard holds no image.

### ⚙️ Extension settings

| Setting | Default | Description |
|---|---|---|
| `clipboardImage.outputDir` | `/tmp/clipboard-images` | Directory to save pasted images |

Rebind the shortcut via `Preferences: Open Keyboard Shortcuts` → search `clipboard-image.paste`.

## 🖥️ Requirements

Node.js ≥ 20 (CLI only), plus a clipboard tool for your platform:

| Platform | Tool |
|---|---|
| **WSL / Windows** | `powershell.exe` (default on all installs) |
| **macOS** | `osascript` (built-in), or [`pngpaste`](https://github.com/jcsalterego/pngpaste) |
| **Linux** | `wl-clipboard` (Wayland) or `xclip` (X11) |

## 🛠️ Development

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

## 🌱 Support & Contributions

Star the repo ⭐ & I power up like Mario 🍄<br>
Devs run on [coffee][coffee-link] ☕<br>
[contributions][fork-link] are welcome.

---
<div align="center">
<sub>Released under <a href="./LICENSE">MIT License</a> | <a href="./PRIVACY.md">Privacy Policy</a></sub>
</div>
