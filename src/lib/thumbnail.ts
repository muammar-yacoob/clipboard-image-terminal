/**
 * Inline image previews in the terminal, via the iTerm2 image protocol
 * (OSC 1337). Supported by VS Code's integrated terminal, iTerm2, and WezTerm —
 * we detect those explicitly and stay silent everywhere else, so an unsupported
 * terminal never gets a screenful of stray base64.
 *
 * The escape sequence goes to stderr (never stdout), keeping `$(clipimg)` clean.
 */
import type { WriteStream } from 'node:tty';

/** Bounding box for the thumbnail, measured in terminal cells. */
export type ThumbBox = { cols: number; rows: number };
const DEFAULT_BOX: ThumbBox = { cols: 30, rows: 10 };

/**
 * True when `stream` is an interactive terminal known to render iTerm2 inline
 * images. Conservative on purpose: a false negative just skips the preview,
 * a false positive dumps base64 at the user.
 */
export function terminalSupportsInlineImages(stream: WriteStream = process.stderr): boolean {
  if (!stream.isTTY) return false; // piped/redirected — nothing to render into

  // tmux/screen need explicit passthrough wrapping we don't emit; skip them.
  if (process.env.TMUX || /screen|tmux/.test(process.env.TERM ?? '')) return false;

  const term = process.env.TERM_PROGRAM;
  return term === 'vscode' || term === 'iTerm.app' || term === 'WezTerm';
}

/**
 * Encode PNG bytes as an iTerm2 inline-image escape sequence, scaled to fit
 * within `box` while preserving aspect ratio.
 */
export function inlineImage(png: Buffer, box: ThumbBox = DEFAULT_BOX): string {
  const args = [
    'inline=1',
    `size=${png.length}`,
    `width=${box.cols}`,
    `height=${box.rows}`,
    'preserveAspectRatio=1',
  ].join(';');
  // OSC 1337 ; File = <args> : <base64> BEL
  return `\x1b]1337;File=${args}:${png.toString('base64')}\x07`;
}

/**
 * Write a thumbnail of `png` to `stream` if the terminal supports it. Returns
 * whether anything was drawn, so the caller can adjust surrounding spacing.
 */
export function printThumbnail(png: Buffer, stream: WriteStream = process.stderr): boolean {
  if (!terminalSupportsInlineImages(stream)) return false;
  stream.write(inlineImage(png) + '\n');
  return true;
}
