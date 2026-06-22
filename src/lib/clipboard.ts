/**
 * Shared clipboard-image logic used by both the VS Code extension and the CLI.
 *
 * Reading the clipboard is OS-specific, so we shell out to the native tool:
 *   - WSL / Windows : PowerShell (System.Windows.Forms.Clipboard)
 *   - macOS         : osascript (or pngpaste if installed)
 *   - Linux         : wl-paste (Wayland) or xclip (X11)
 *
 * Every backend returns PNG bytes — lossless, so screenshots of code/text stay
 * crisp for vision models. Images are saved keyed by content hash, so pasting
 * the same image twice is a no-op.
 */
import { createHash } from 'node:crypto';
import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  readdirSync, statSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const DEFAULT_OUTPUT_DIR = '/tmp/clipboard-images';
const TIMEOUT = 8000;
const MAX_BUFFER = 50 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // prune saved images after 7 days

// Options for clipboard tools that stream raw image bytes to stdout (returns a Buffer).
const BIN_OPTS: ExecFileSyncOptionsWithBufferEncoding = {
  timeout: TIMEOUT,
  maxBuffer: MAX_BUFFER,
  stdio: ['ignore', 'pipe', 'ignore'],
  encoding: 'buffer',
};

type Platform = 'wsl' | 'windows' | 'macos' | 'linux';

function detectPlatform(): Platform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  if (process.env.WSL_DISTRO_NAME) return 'wsl';
  try {
    if (readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')) return 'wsl';
  } catch { /* not WSL */ }
  return 'linux';
}

// Exit 1 (treated as "no image") on an empty clipboard or any transient
// clipboard error — never leak a PowerShell stack trace to the user's terminal.
const PS_READ_CLIPBOARD = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 1 }

  $img = [System.Windows.Forms.Clipboard]::GetImage()
  try {
    $ms = New-Object System.IO.MemoryStream
    $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    [Console]::Write([Convert]::ToBase64String($ms.ToArray()))
    $ms.Dispose()
  } finally {
    $img.Dispose()
  }
} catch {
  exit 1
}
`;

function readViaPowerShell(): Buffer | null {
  try {
    const b64 = execFileSync('powershell.exe', [
      '-STA', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS_READ_CLIPBOARD,
    ], { encoding: 'utf8', timeout: TIMEOUT, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 1) return null; // no image on clipboard
    throw err;
  }
}

function readViaLinux(): Buffer | null {
  const attempts: Array<[string, string[]]> = [
    ['wl-paste', ['--no-newline', '--type', 'image/png']], // Wayland
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']], // X11
  ];

  let toolFound = false;
  for (const [bin, args] of attempts) {
    try {
      const out = execFileSync(bin, args, BIN_OPTS);
      return out.length ? out : null;
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') toolFound = true; // ran but no image
    }
  }

  if (!toolFound) {
    throw new Error('No clipboard tool found. Install wl-clipboard (Wayland) or xclip (X11), then copy an image.');
  }
  return null; // tool present, but no image on clipboard
}

function readViaMac(): Buffer | null {
  const tmp = join(tmpdir(), 'clipimg-clipboard.png');
  const script = `
on run
  try
    set thePng to (the clipboard as «class PNGf»)
  on error
    return "NOIMAGE"
  end try
  set f to open for access POSIX file ${JSON.stringify(tmp)} with write permission
  set eof f to 0
  write thePng to f
  close access f
  return "OK"
end run
`;

  try {
    const res = execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: TIMEOUT }).trim();
    if (res !== 'OK') return null;
    const buf = readFileSync(tmp);
    try { unlinkSync(tmp); } catch { /* best effort */ }
    return buf.length ? buf : null;
  } catch {
    // Fallback to pngpaste if the user has it installed.
    try {
      const out = execFileSync('pngpaste', ['-'], BIN_OPTS);
      return out.length ? out : null;
    } catch {
      return null;
    }
  }
}

/**
 * Read the current clipboard image as PNG bytes for the host platform.
 * Returns `null` when the clipboard holds no image.
 */
export function readClipboardImage(): Buffer | null {
  const platform = detectPlatform();
  switch (platform) {
    case 'wsl':
    case 'windows':
      return readViaPowerShell();
    case 'macos':
      return readViaMac();
    case 'linux':
      return readViaLinux();
    default: {
      const unreachable: never = platform; // compile error if a Platform is unhandled
      throw new Error(`Unsupported platform: ${String(unreachable)}`);
    }
  }
}

/** Delete saved images older than MAX_AGE_MS so the output dir can't grow forever. */
function pruneOldImages(outputDir: string): void {
  try {
    const now = Date.now();
    for (const name of readdirSync(outputDir)) {
      if (!name.endsWith('.png')) continue;
      const p = join(outputDir, name);
      try {
        if (now - statSync(p).mtimeMs > MAX_AGE_MS) unlinkSync(p);
      } catch { /* skip files we can't stat/remove */ }
    }
  } catch { /* dir not readable yet */ }
}

/**
 * Save image bytes to `outputDir`, named by a short content hash. Re-saving
 * identical bytes is skipped. Returns the absolute file path.
 */
export function saveImage(buf: Buffer, outputDir: string = DEFAULT_OUTPUT_DIR): string {
  mkdirSync(outputDir, { recursive: true });
  pruneOldImages(outputDir);

  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const filePath = join(outputDir, `${hash}.png`);

  if (!existsSync(filePath)) {
    writeFileSync(filePath, buf);
  }

  return filePath;
}

/**
 * Grab the clipboard image and persist it. Returns the saved path, or `null`
 * when there is no image on the clipboard.
 */
export function captureClipboardImage(outputDir: string = DEFAULT_OUTPUT_DIR): string | null {
  const buf = readClipboardImage();
  if (!buf) return null;
  return saveImage(buf, outputDir);
}
