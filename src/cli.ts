#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { Command } from 'commander';
import {
  captureClipboardImage, bumpPasteCounter, DEFAULT_OUTPUT_DIR,
  type CaptureEvent, type PasteSummary,
} from './lib/clipboard';
import { runDoctor, type ToolStatus } from './lib/doctor';
import { showHelp } from './lib/help';
import { fmt } from './lib/logger';
import { humanAge, humanSize } from './lib/format';
import { clearStore, readStore } from './lib/store';
import { printThumbnail, terminalSupportsInlineImages } from './lib/thumbnail';
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

// Default command: read the clipboard once, save it, print the path, exit.
function capture(opts: { dir: string; quiet?: boolean }): void {
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
}

// `status` / `ls`: show what the on-disk store holds — clipimg keeps nothing in RAM.
function showStatus(opts: { dir: string }): void {
  const store = readStore(opts.dir);
  const now = Date.now();

  console.log();
  console.log(`${fmt.magenta('◆')} ${fmt.bold('clipimg store')}  ${fmt.dim('·')}  ${fmt.cyan(store.dir)}`);
  const noun = store.count === 1 ? 'image' : 'images';
  console.log(
    `  ${fmt.bold(String(store.count))} ${noun} ${fmt.dim('·')} ${humanSize(store.totalBytes)} on disk ` +
    `${fmt.dim('·')} ${fmt.dim('no background process (each capture runs once and exits — 0 B resident)')}`,
  );
  if (store.counter !== null) console.log(`  ${fmt.dim(`lifetime pastes: #${store.counter}`)}`);

  if (store.count === 0) {
    console.log();
    console.log(fmt.dim('  empty — copy an image and run `clipimg` to add one'));
    return;
  }

  console.log();
  const showThumb = terminalSupportsInlineImages(process.stdout);
  store.entries.forEach((e, i) => {
    const idx = fmt.dim(`${i + 1}`.padStart(2));
    const name = fmt.cyan(e.name.replace(/\.png$/, '').slice(0, 12));
    const age = humanAge(now - e.mtimeMs).padEnd(8);
    const dims = (e.width && e.height ? `${e.width}×${e.height}` : '—').padEnd(11);
    const size = humanSize(e.bytes).padEnd(9);
    const tok = e.tokens ? fmt.dim(`~${e.tokens} tok`) : '';
    console.log(`  ${idx}  ${name}  ${fmt.dim(age)}  ${dims}  ${size} ${tok}`);
    if (showThumb) {
      try { printThumbnail(readFileSync(e.path), process.stdout); } catch { /* best effort */ }
    }
  });
  console.log();
  console.log(fmt.dim('  clear all with `clipimg clear`'));
}

// `clear` / `clean`: wipe the on-disk store (this is "clearing its memory").
function clearCmd(opts: { dir: string }): void {
  const before = readStore(opts.dir);
  if (before.count === 0) {
    console.log(fmt.yellow(`Store already empty · ${opts.dir}`));
    return;
  }
  const res = clearStore(opts.dir);
  const noun = res.removed === 1 ? 'image' : 'images';
  console.log(
    `${fmt.green('✓')} Cleared ${fmt.bold(String(res.removed))} ${noun} ` +
    `${fmt.dim('·')} freed ${humanSize(res.freedBytes)} ${fmt.dim('·')} ${fmt.dim(opts.dir)}`,
  );
  console.log(fmt.dim('  paste counter reset to 0'));
}

// `doctor` / `deps`: report the clipboard backend tools for this platform.
function doctorCmd(): void {
  const report = runDoctor();
  const icon: Record<ToolStatus, string> = {
    ok: fmt.green('✓'),
    broken: fmt.red('✗'),
    missing: fmt.yellow('○'),
  };

  console.log();
  console.log(`${fmt.magenta('◆')} ${fmt.bold('clipimg doctor')}  ${fmt.dim('·')}  platform: ${fmt.cyan(report.platform)}`);
  console.log();
  for (const c of report.checks) {
    const mark = c.required && c.status !== 'ok' ? fmt.red('✗') : icon[c.status];
    const tag = c.required ? '' : fmt.dim(' (optional)');
    console.log(`  ${mark} ${fmt.bold(c.name)}${tag}  ${fmt.dim(c.role)}`);
    if (c.status !== 'ok' && c.hint) console.log(`      ${fmt.dim('→')} ${c.hint}`);
  }
  console.log();
  console.log(
    report.ok
      ? fmt.green('  All required tools are available.')
      : fmt.yellow('  Some required tools are missing — clipboard capture may not work until they are installed.'),
  );
  console.log(fmt.dim('  Note: clipimg never auto-installs system packages (that needs root and varies per distro).'));
  process.exit(report.ok ? 0 : 1);
}

// Show the rich figlet help for a top-level `help`, `-h`, or `--help`. Leaving
// subcommand flags (e.g. `clipimg status --help`) to commander.
const argv = process.argv.slice(2);
if (argv[0] === 'help' || argv[0] === '-h' || argv[0] === '--help') {
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
  .action((opts: { dir: string; quiet?: boolean }) => capture(opts));

program
  .command('status')
  .aliases(['ls', 'list'])
  .description('Show the saved-image store: count, size, and each image')
  .option('-d, --dir <path>', 'output directory', DEFAULT_OUTPUT_DIR)
  .action((opts: { dir: string }) => showStatus(opts));

program
  .command('clear')
  .alias('clean')
  .description('Delete every saved image and reset the paste counter')
  .option('-d, --dir <path>', 'output directory', DEFAULT_OUTPUT_DIR)
  .action((opts: { dir: string }) => clearCmd(opts));

program
  .command('doctor')
  .alias('deps')
  .description('Check the clipboard tools this platform needs')
  .action(() => doctorCmd());

program.parse(process.argv);
