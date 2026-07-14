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

/** Summary of a completed paste — dimensions and vision-token accounting. */
export type PasteSummary = {
  width: number;
  height: number;
  tokens: number; // estimated vision tokens for the saved image
  originalTokens: number; // what it would have cost uncompressed (high-res tier)
  savedTokens: number; // originalTokens - tokens, never negative
};

// Each stage the capture passes through, so callers can paint a live, staged UI.
// The stages fire in order: reading → (compressing) → saving → pasted.
export type CaptureEvent =
  | { type: 'reading' }
  | { type: 'compressing' }
  | { type: 'saving' }
  | ({ type: 'pasted' } & PasteSummary);

// Options for clipboard tools that stream raw image bytes to stdout (returns a Buffer).
const BIN_OPTS: ExecFileSyncOptionsWithBufferEncoding = {
  timeout: TIMEOUT,
  maxBuffer: MAX_BUFFER,
  stdio: ['ignore', 'pipe', 'ignore'],
  encoding: 'buffer',
};

export type Platform = 'wsl' | 'windows' | 'macos' | 'linux';

export function detectPlatform(): Platform {
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
    // Any other failure means powershell.exe couldn't run at all (commonly WSL
    // Windows-interop being down). Surface a short, actionable message instead
    // of letting execFileSync leak the entire command + embedded script.
    throw new Error(
      'could not read the Windows clipboard via powershell.exe — on WSL this usually means Windows interop is down. Run `clipimg doctor`.',
    );
  }
}

// WSLg exposes the Windows-bridged Wayland clipboard at a fixed socket. It's
// present on all modern WSL2 installs regardless of interop state.
const WSLG_RUNTIME_DIR = '/mnt/wslg/runtime-dir';

// wl-paste/xclip need WAYLAND_DISPLAY/DISPLAY *and* an XDG_RUNTIME_DIR that holds
// the display socket. A login shell inherits these, but the contexts that need
// the fallback most — VS Code's extension host, the detached `clipimg watch`
// daemon, a bare `sh -c` — don't, so wl-paste can't find the WSLg socket even
// though it's right there. Point the env at WSLg's runtime dir (unless the
// current one already has the socket) so the fallback can actually connect.
// Returns true when a WSLg/X11 clipboard looks reachable.
function ensureWslgDisplayEnv(): boolean {
  const wayland = process.env.WAYLAND_DISPLAY || 'wayland-0';
  const wslgSocket = join(WSLG_RUNTIME_DIR, wayland);

  if (existsSync(wslgSocket)) {
    const runtimeDir = process.env.XDG_RUNTIME_DIR;
    if (!runtimeDir || !existsSync(join(runtimeDir, wayland))) {
      process.env.XDG_RUNTIME_DIR = WSLG_RUNTIME_DIR;
    }
    process.env.WAYLAND_DISPLAY = wayland;
    if (!process.env.DISPLAY) process.env.DISPLAY = ':0'; // WSLg's X server, for xclip
    return true;
  }

  // No WSLg socket — only usable if a display was already configured (real X11).
  return Boolean(process.env.WAYLAND_DISPLAY || process.env.DISPLAY);
}

// On WSL, prefer PowerShell but fall back to WSLg's bridged clipboard when it
// can't run (Windows interop down → "exec format error"). wl-paste/xclip read
// the Windows clipboard through WSLg without any interop.
function readViaWsl(): Buffer | null {
  try {
    return readViaPowerShell();
  } catch (psErr) {
    if (ensureWslgDisplayEnv()) {
      return readViaLinux(); // WSLg fallback; its own error is the actionable one here
    }
    throw psErr;
  }
}

// A clipboard reader for a Linux display server: list the MIME types on offer,
// then fetch the bytes of a chosen one.
type ClipboardReader = { listTypes(): string[]; read(mime: string): Buffer };

const splitLines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);

const wlPasteReader: ClipboardReader = {
  listTypes: () => splitLines(
    execFileSync('wl-paste', ['--list-types'], { encoding: 'utf8', timeout: TIMEOUT }),
  ),
  read: (mime) => execFileSync('wl-paste', ['--no-newline', '--type', mime], BIN_OPTS),
};

const xclipReader: ClipboardReader = {
  listTypes: () => splitLines(
    execFileSync('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], { encoding: 'utf8', timeout: TIMEOUT }),
  ),
  read: (mime) => execFileSync('xclip', ['-selection', 'clipboard', '-t', mime, '-o'], BIN_OPTS),
};

// Prefer PNG; otherwise take any offered image type (Windows/WSLg offers image/bmp).
function pickImageType(types: string[]): string | null {
  return types.includes('image/png') ? 'image/png' : types.find((t) => t.startsWith('image/')) ?? null;
}

// Convert non-PNG clipboard bytes (e.g. a WSLg BMP) to PNG via ImageMagick.
// `-strip` drops the date/time metadata ImageMagick would otherwise embed, so the
// same source always yields byte-identical PNG — keeping the content-hash dedup
// working (without it, the watcher re-saves the same image every poll).
function convertToPng(buf: Buffer, mime: string): Buffer {
  const srcFmt = mime.split('/')[1] ?? 'bmp';
  for (const bin of ['magick', 'convert']) {
    try {
      return execFileSync(bin, [`${srcFmt}:-`, '-strip', 'png:-'], {
        input: buf, timeout: TIMEOUT, maxBuffer: MAX_BUFFER, encoding: 'buffer', stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err; // tool ran but failed
    }
  }
  throw new Error(`clipboard holds a ${mime} image; install ImageMagick to convert it to PNG.`);
}

/**
 * Read the clipboard image on Linux/WSLg. The clipboard may only offer a non-PNG
 * type (Windows hands WSLg an image/bmp), so negotiate the best available image
 * type and convert it to PNG when needed.
 */
function readViaLinux(): Buffer | null {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  const x11 = Boolean(process.env.DISPLAY);

  // Match the tool to the session: wl-paste for Wayland, xclip for X11. When the
  // session type is unknown (neither display var set) we try both.
  const readers: ClipboardReader[] = [];
  if (wayland || !x11) readers.push(wlPasteReader);
  if (x11 || !wayland) readers.push(xclipReader);

  let present = false;
  for (const reader of readers) {
    let types: string[];
    try {
      types = reader.listTypes();
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') present = true; // installed but failed
      continue;
    }
    present = true;
    const mime = pickImageType(types);
    if (!mime) continue; // this reader has no image on the clipboard
    const raw = reader.read(mime);
    if (!raw.length) continue;
    return mime === 'image/png' ? raw : convertToPng(raw, mime);
  }

  if (!present) {
    // Nothing we tried is installed — name the tool that fits this session.
    const tool = wayland ? 'wl-clipboard (Wayland)'
      : x11 ? 'xclip (X11)'
      : 'wl-clipboard (Wayland) or xclip (X11)';
    throw new Error(`No clipboard tool found. Install ${tool}, then copy an image.`);
  }
  return null; // tool present, but no image on the clipboard
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
    case 'windows':
      return readViaPowerShell();
    case 'wsl':
      return readViaWsl();
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
    try {
      const script = PS_RESIZE.replace(/__W__/g, String(w)).replace(/__H__/g, String(h));
      const b64 = execFileSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
      ], { input: buf.toString('base64'), encoding: 'utf8', timeout: TIMEOUT, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      return Buffer.from(b64, 'base64');
    } catch (err) {
      // Native Windows has no other backend; on WSL, interop may be down (the
      // same reason capture falls back to WSLg) — drop to ImageMagick below.
      if (platform === 'windows') throw err;
    }
  }

  // macOS / Linux / WSL-with-interop-down: stream PNG through ImageMagick (stdin -> stdout, no temp files).
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
 * Whether {@link compressImage} would resize this buffer — i.e. it decodes as a
 * PNG and exceeds the visual-token budget. Lets a caller announce "compressing…"
 * *before* the (blocking) resize runs.
 */
export function needsCompression(buf: Buffer): boolean {
  const dims = pngDimensions(buf);
  return dims !== null && dims.width * dims.height > MAX_PIXELS;
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

/** Short content hash (first 16 hex of sha256) — used to name and dedupe images. */
export function shortHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * Save image bytes to `outputDir`, named by a short content hash. Re-saving
 * identical bytes is skipped. Returns the absolute file path.
 */
export function saveImage(buf: Buffer, outputDir: string = DEFAULT_OUTPUT_DIR): string {
  mkdirSync(outputDir, { recursive: true });
  pruneOldImages(outputDir);

  const hash = shortHash(buf);
  const filePath = join(outputDir, `${hash}.png`);

  if (!existsSync(filePath)) {
    writeFileSync(filePath, buf);
  }

  return filePath;
}

/**
 * Compare the original and saved bytes and report vision-token accounting.
 * Returns `null` when the saved buffer isn't a decodable PNG.
 */
export function summarizePaste(raw: Buffer, finalBuf: Buffer): PasteSummary | null {
  const after = pngDimensions(finalBuf);
  if (!after) return null;

  const before = pngDimensions(raw) ?? after;
  const tokens = estimateImageTokens(after.width, after.height);
  const originalTokens = Math.min(estimateImageTokens(before.width, before.height), HIRES_MAX_TOKENS);
  return {
    width: after.width,
    height: after.height,
    tokens,
    originalTokens,
    savedTokens: Math.max(0, originalTokens - tokens),
  };
}

/**
 * A monotonic count of pastes, persisted alongside the saved images so the
 * number survives across CLI invocations (each run is a fresh process). Used to
 * label pastes `[img #n]`. Best-effort: falls back to 1 if the dir isn't writable.
 */
export function bumpPasteCounter(outputDir: string = DEFAULT_OUTPUT_DIR): number {
  try {
    mkdirSync(outputDir, { recursive: true });
    const counterFile = join(outputDir, '.paste-count');
    let n = 0;
    try { n = parseInt(readFileSync(counterFile, 'utf8'), 10) || 0; } catch { /* first paste */ }
    n += 1;
    writeFileSync(counterFile, String(n));
    return n;
  } catch {
    return 1;
  }
}

/**
 * Grab the clipboard image and persist it. Returns the saved path, or `null`
 * when there is no image on the clipboard.
 */
export function captureClipboardImage(
  outputDir: string = DEFAULT_OUTPUT_DIR,
  onEvent?: (event: CaptureEvent) => void,
): string | null {
  onEvent?.({ type: 'reading' });
  const raw = readClipboardImage();
  if (!raw) return null;

  const finalBuf = compressImage(raw, () => onEvent?.({ type: 'compressing' }));

  onEvent?.({ type: 'saving' });
  const filePath = saveImage(finalBuf, outputDir);

  if (onEvent) {
    const summary = summarizePaste(raw, finalBuf);
    if (summary) onEvent({ type: 'pasted', ...summary });
  }

  return filePath;
}
