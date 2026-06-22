/**
 * Colored console output utilities using ANSI codes.
 */

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export const fmt = {
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  white: (s: string) => `${WHITE}${s}${RESET}`,
  gray: (s: string) => `${GRAY}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
};
