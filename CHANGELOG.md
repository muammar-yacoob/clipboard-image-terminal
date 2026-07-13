# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **WSL clipboard fallback via WSLg** — when Windows interop is down (`powershell.exe`
  fails with "exec format error"), clipimg now reads the clipboard through the
  WSLg-bridged Wayland/X11 clipboard (`wl-paste`/`xclip`), so it keeps working
  without an interop fix. `clipimg doctor` reports which path is active.
- **Background clipboard watcher** — bare `clipimg` now starts a detached daemon
  that polls the clipboard and auto-saves each new image to the store; running it
  again reports `already running` with the pid, uptime, and image count.
  `clipimg stop` ends it, and `clipimg status` shows its state.
- **`clipimg paste` (alias `grab`)** — the one-off capture that prints an image
  path (what `$(clipimg paste)` uses). Accepts `-q, --quiet`.
- **`clipimg logs`** — show the watcher's activity log, colorized on display; the
  on-disk `.daemon.log` stays plain text (grep/less friendly).
- **Clickable images** — `clipimg status` renders each saved image (and the store
  path) as an OSC 8 `file://` hyperlink you can click to open in the default viewer.
- **Help on invalid usage** — an unknown command or bad flag now prints the full
  help and exits non-zero; `-h`/`--help`/`help`/`-v` exit 0.

### Changed
- **BREAKING: bare `clipimg` starts the watcher** instead of capturing. The
  capture-and-print-path behavior moved to `clipimg paste`, so update pipelines
  from `$(clipimg)` to `$(clipimg paste)`.
- **`-d, --dir` works before or after a subcommand** (`clipimg -d X status` and
  `clipimg status -d X` are equivalent).

### Added (store & diagnostics)
- **`clipimg status` (alias `ls`)** — inspect the on-disk store: image count,
  total size, and each saved image with its dimensions, size, age, estimated
  vision tokens, and an inline thumbnail where the terminal supports it.
- **`clipimg clear` (alias `clean`)** — delete every saved image and reset the
  `[img #n]` counter, reporting how much disk space was freed.
- **`clipimg doctor` (alias `deps`)** — check the clipboard tools the current
  platform needs and, for anything missing, how to install it. Detects the WSL
  Windows-interop "exec format error" state and prints the fix.
- **Staged, colorful paste feedback** — the CLI now shows each step in place
  (`◇ reading → ❖ compressing → ▸ saving`) and finishes with a brand-colored
  `[img #n]` line carrying tokens, dimensions, size, and savings. The VS Code
  extension mirrors the stages in a progress notification and a colored
  `[img #n]` status-bar confirmation.
- **Inline thumbnail preview** — after a paste the CLI renders a small preview of
  the image (iTerm2 protocol) in terminals that support it — VS Code's integrated
  terminal, iTerm2, and WezTerm — and stays silent everywhere else. Goes to
  stderr, so stdout stays clean for `$(clipimg)`.
- **`-q, --quiet` flag** — suppresses the staged UI and preview, printing only the
  image path. Errors are still reported. Handy for scripting.
- **`NO_COLOR` support** — the CLI now honors the
  [`NO_COLOR`](https://no-color.org) convention; any non-empty value disables all
  ANSI color (the banner, staged lines, and `[img #n]` badge included).
- **Automatic image compression** — oversized pastes are downscaled to fit a
  vision-token budget (~1568 tokens) before saving, cutting the token cost of a
  4K screenshot by ~66% on high-resolution models. Resolution stays at the level
  Claude treats as full quality, and images already small enough are untouched.
- **Token logging** — the CLI prints the estimated vision tokens (and savings)
  for each paste in color on stderr; the VS Code extension shows it in the status
  bar. stdout stays clean for `$(clipimg)`.
- macOS resize falls back to the built-in `sips` when ImageMagick isn't installed.

### Changed
- **Help clarifies the one-shot model** — `clipimg` runs once per capture and
  exits; there is no daemon to start/stop and no RAM used between runs. The saved
  images on disk are the "store", managed via `status`/`clear`.

## [0.2.0] - 2026-06-22

### Added
- **Cross-platform support** — macOS (`osascript`/`pngpaste`) and Linux
  (`wl-clipboard`/`xclip`), alongside the existing WSL/Windows PowerShell path.
- **Terminal right-click menu** entry to paste the clipboard image path.
- **`clipboardImage.outputDir`** setting for the VS Code extension.
- **Auto-prune** of saved images older than 7 days.
- Colorful CLI confirmation (`✔ Image saved`) when run interactively — stdout
  stays clean for `$(clipimg)`.

### Changed
- Images are now saved as **lossless PNG** instead of compressed JPEG, keeping
  screenshots of code and text crisp for vision models.

## [0.1.0]

### Added
- Initial release: VS Code extension (`Ctrl+Alt+V`) and `clipimg` CLI for
  pasting the Windows clipboard image as a file path on WSL.
