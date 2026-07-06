#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { Command } from 'commander';
import {
  captureClipboardImage, bumpPasteCounter, DEFAULT_OUTPUT_DIR,
  type CaptureEvent, type PasteSummary,
} from './lib/clipboard';
import { showHelp } from './lib/help';
import { fmt } from './lib/logger';
import { humanSize } from './lib/format';
import { printThumbnail } from './lib/thumbnail';
import { errorMessage } from './lib/errors';

// out/cli.js sits one level below package.json
function getVersion(): string {
  try {
    return require('../package.json').version as string;
  } catch {
    return '0.0.0';
  }
}

// #1e9bd7 — the extension's gallery-banner blue, reused for the `[img #n]` badge.
const BRAND: [number, number, number] = [30, 155, 215];

// A single self-overwriting status line while we work — only when stderr is a
// TTY, so redirected output stays clean.
const tty = Boolean(process.stderr.isTTY);
function stage(icon: string, label: string): void {
  if (tty) process.stderr.write(`\r\x1b[K${icon} ${label}`);
}
function clearStage(): void {
  if (tty) process.stderr.write('\r\x1b[K');
}

// Colorful, staged feedback for each step of the paste.
function onEvent(event: CaptureEvent): PasteSummary | void {
  switch (event.type) {
    case 'reading':
      return void stage(fmt.cyan('◇'), fmt.cyan('reading clipboard…'));
    case 'compressing':
      return void stage(fmt.yellow('❖'), fmt.yellow('compressing…'));
    case 'saving':
      return void stage(fmt.blue('▸'), fmt.blue('saving…'));
    case 'pasted':
      return event; // hand the summary back to the caller for the final line
  }
}

// The colorful `[img #n]` result line, e.g.
//   ◆ [img #3]  ~420 tok · 1024×768 · 42.0 KB  ↓ saved ~1148 (73%)
function pastedLine(n: number, filePath: string, s: PasteSummary | undefined): string {
  const badge = fmt.bold(fmt.rgb(...BRAND, `[img #${n}]`));
  const parts = [fmt.magenta('◆'), badge];

  if (s) {
    const size = humanSize(statSync(filePath).size);
    parts.push(fmt.dim('·'), fmt.bold(`~${s.tokens} tok`));
    parts.push(fmt.dim('·'), fmt.dim(`${s.width}×${s.height}`));
    parts.push(fmt.dim('·'), fmt.dim(size));
    if (s.savedTokens > 0) {
      const pct = Math.round((s.savedTokens / s.originalTokens) * 100);
      parts.push(' ', fmt.green(`↓ saved ~${s.savedTokens} (${pct}%)`));
    }
  }
  return parts.join(' ');
}

// Show the rich figlet help for `help`, `-h`, `--help`.
const argv = process.argv.slice(2);
if (argv[0] === 'help' || argv.includes('-h') || argv.includes('--help')) {
  showHelp();
  process.exit(0);
}

const program = new Command();

program
  .name('clipimg')
  .description('Save the clipboard image to a file and print its path (WSL, macOS, Linux)')
  .version(getVersion(), '-v, --version')
  .option('-d, --dir <path>', 'output directory', DEFAULT_OUTPUT_DIR)
  .option('-q, --quiet', 'suppress the staged UI and preview; print only the path')
  .action((opts: { dir: string; quiet?: boolean }) => {
    const quiet = Boolean(opts.quiet);
    try {
      // All logging goes to stderr so stdout stays clean for `claude "$(clipimg)"`.
      let summary: PasteSummary | undefined;
      const filePath = captureClipboardImage(opts.dir, quiet ? undefined : (event) => {
        const s = onEvent(event);
        if (s) summary = s;
      });

      if (!filePath) {
        clearStage();
        console.error(fmt.yellow('No image on clipboard'));
        process.exit(1);
      }

      if (!quiet) {
        const n = bumpPasteCounter(opts.dir);
        clearStage();
        console.error(pastedLine(n, filePath, summary));

        // Inline preview when the terminal can render it (VS Code, iTerm2, WezTerm).
        try { printThumbnail(readFileSync(filePath)); } catch { /* preview is best-effort */ }
      }

      // The path goes to stdout so it stays pipeable: `claude "$(clipimg)"`.
      console.log(filePath);
    } catch (err: unknown) {
      clearStage();
      console.error(fmt.red(`Clipboard image failed: ${errorMessage(err)}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
