/**
 * Colored console output utilities using ANSI codes.
 *
 * All styling funnels through `fmt` so color can be turned off in one place.
 * We honor the NO_COLOR convention (https://no-color.org): any non-empty value
 * disables color, so `fmt.*` returns its input unchanged.
 */

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const colorEnabled = !process.env.NO_COLOR;

// Wrap `s` in an ANSI sequence, or pass it through untouched when color is off.
const style = (open: string) => (s: string) => (colorEnabled ? `${open}${s}${RESET}` : s);

export const fmt = {
  cyan: style(CYAN),
  blue: style(BLUE),
  magenta: style(MAGENTA),
  yellow: style(YELLOW),
  green: style(GREEN),
  red: style(RED),
  gray: style(GRAY),
  bold: style(BOLD),
  dim: style(DIM),
  // 24-bit color — used for the brand-colored `[img #n]` badge and the banner.
  rgb: (r: number, g: number, b: number, s: string) =>
    colorEnabled ? `\x1b[38;2;${r};${g};${b}m${s}${RESET}` : s,
};
