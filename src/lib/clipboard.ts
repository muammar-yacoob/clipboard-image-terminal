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

import { estimateImageTokens, PATCH_PX } from './format';

export const DEFAULT_OUTPUT_DIR = '/tmp/clipboard-images';
const TIMEOUT = 8000;
const MAX_BUFFER = 50 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // prune saved images after 7 days

// Vision models bill by pixel area, not file size: one token per 28×28px patch.
// We downscale to fit a visual-token budget — Anthropic's own "standard" tier
// caps quality here and downscales anything larger anyway, so this is the most
// tokens we can shave while staying at a resolution Claude considers sufficient.
export const TARGET_TOKENS = 1568;
const MAX_PIXELS = TARGET_TOKENS * PATCH_PX * PATCH_PX; // ≈1.23 MP

// A high-resolution-tier model (Opus 4.7/4.8, Fable 5) charges up to this many
// tokens for one image, downscaling beyond it. We cap the "before" estimate here
// so reported savings reflect what an oversized paste would actually have cost.
const HIRES_MAX_TOKENS = 4784;

/** What happened while capturing — surfaced to callers so they can log it. */
export type CaptureEvent =
  | { type: 'compressing' }
  | {
      type: 'pasted';
      width: number;
      height: number;
      tokens: number; // estimated vision tokens for the saved image
      originalTokens: number; // what it would have cost uncompressed (high-res tier)
      savedTokens: number; // originalTokens - tokens, never negative
    };

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

// Resize a PNG buffer to exactly w×h, keeping everything in memory (base64 over
// stdin) so we never have to hand a Linux temp path to a Windows process.
const PS_RESIZE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$ms = New-Object System.IO.MemoryStream(,$bytes)
$img = [System.Drawing.Image]::FromStream($ms)
$bmp = New-Object System.Drawing.Bitmap(__W__, __H__)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, __W__, __H__)
$out = New-Object System.IO.MemoryStream
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Write([Convert]::ToBase64String($out.ToArray()))
`;

/** Read a PNG's pixel dimensions from its IHDR header, or null if not a PNG. */
export function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  // 8-byte signature, then IHDR: length(4) + type(4) + width(4) + height(4).
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function resizeViaTool(buf: Buffer, w: number, h: number): Buffer {
  const platform = detectPlatform();
  if (platform === 'wsl' || platform === 'windows') {
    const script = PS_RESIZE.replace(/__W__/g, String(w)).replace(/__H__/g, String(h));
    const b64 = execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
    ], { input: buf.toString('base64'), encoding: 'utf8', timeout: TIMEOUT, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return Buffer.from(b64, 'base64');
  }

  // macOS / Linux: stream PNG through ImageMagick (stdin -> stdout, no temp files).
  for (const bin of ['magick', 'convert']) {
    try {
      return execFileSync(bin, ['png:-', '-resize', `${w}x${h}`, 'png:-'], {
        input: buf, timeout: TIMEOUT, maxBuffer: MAX_BUFFER, encoding: 'buffer', stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err; // tool ran but failed
    }
  }

  // macOS ships `sips` even without ImageMagick — fall back to it (needs temp files).
  if (detectPlatform() === 'macos') return resizeViaSips(buf, w, h);

  throw new Error('No image resizing tool found (install ImageMagick)');
}

// sips can't stream, so round-trip through temp files. pid + a per-call counter
// keeps concurrent pastes (e.g. in the long-lived extension host) from clobbering
// each other, without needing a random/timestamp source.
let sipsTempSeq = 0;
function resizeViaSips(buf: Buffer, w: number, h: number): Buffer {
  const id = `${process.pid}-${sipsTempSeq++}`;
  const tmpIn = join(tmpdir(), `clipimg-resize-in-${id}.png`);
  const tmpOut = join(tmpdir(), `clipimg-resize-out-${id}.png`);
  try {
    writeFileSync(tmpIn, buf);
    // `-z height width` resamples to an exact size; our w/h already preserve aspect.
    execFileSync('sips', ['-z', String(h), String(w), tmpIn, '--out', tmpOut], {
      timeout: TIMEOUT, stdio: 'ignore',
    });
    return readFileSync(tmpOut);
  } finally {
    try { unlinkSync(tmpIn); } catch { /* best effort */ }
    try { unlinkSync(tmpOut); } catch { /* best effort */ }
  }
}

/**
 * Downscale a clipboard PNG to fit the visual-token budget, saving tokens for
 * vision models. Images already small enough (and anything that isn't a
 * decodable PNG) are returned untouched. `onCompress` fires only when a resize
 * actually happens. Any failure falls back to the original bytes.
 */
export function compressImage(buf: Buffer, onCompress?: () => void): Buffer {
  const dims = pngDimensions(buf);
  if (!dims) return buf;

  const pixels = dims.width * dims.height;
  if (pixels <= MAX_PIXELS) return buf;

  // Scale area down to the budget, preserving aspect ratio.
  const scale = Math.sqrt(MAX_PIXELS / pixels);
  const w = Math.max(1, Math.round(dims.width * scale));
  const h = Math.max(1, Math.round(dims.height * scale));

  onCompress?.();
  try {
    const out = resizeViaTool(buf, w, h);
    return out.length ? out : buf;
  } catch {
    return buf; // best effort — a paste with extra tokens beats no paste at all
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
export function captureClipboardImage(
  outputDir: string = DEFAULT_OUTPUT_DIR,
  onEvent?: (event: CaptureEvent) => void,
): string | null {
  const raw = readClipboardImage();
  if (!raw) return null;

  const finalBuf = compressImage(raw, () => onEvent?.({ type: 'compressing' }));
  const filePath = saveImage(finalBuf, outputDir);

  if (onEvent) {
    const after = pngDimensions(finalBuf);
    const before = pngDimensions(raw) ?? after;
    if (after) {
      const tokens = estimateImageTokens(after.width, after.height);
      const originalTokens = before
        ? Math.min(estimateImageTokens(before.width, before.height), HIRES_MAX_TOKENS)
        : tokens;
      onEvent({
        type: 'pasted',
        width: after.width,
        height: after.height,
        tokens,
        originalTokens,
        savedTokens: Math.max(0, originalTokens - tokens),
      });
    }
  }

  return filePath;
}
