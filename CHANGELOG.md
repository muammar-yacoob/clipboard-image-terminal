# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
