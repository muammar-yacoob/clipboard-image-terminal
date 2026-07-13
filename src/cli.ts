#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { Command } from 'commander';
import {
  captureClipboardImage, bumpPasteCounter, DEFAULT_OUTPUT_DIR,
  type CaptureEvent, type PasteSummary,
} from './lib/clipboard';
import { readDaemon, readDaemonLog, runWatchLoop, startDaemon, stopDaemon } from './lib/daemon';
import { runDoctor, type ToolStatus } from './lib/doctor';
import { showHelp } from './lib/help';
import { fmt, hyperlink } from './lib/logger';
import { humanAge, humanDuration, humanSize } from './lib/format';
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

// "image" / "images" for a count.
const plural = (n: number): string => (n === 1 ? 'image' : 'images');

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

// Colorful, staged feedback for each step of a paste.
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

// `paste`: read the clipboard once, save it, print the path, exit.
function capture(opts: { dir: string; quiet?: boolean }): void {
  const quiet = Boolean(opts.quiet);
  try {
    // All logging goes to stderr so stdout stays clean for `claude "$(clipimg paste)"`.
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

    // The path goes to stdout so it stays pipeable: `claude "$(clipimg paste)"`.
    console.log(filePath);
  } catch (err: unknown) {
    clearStage();
    console.error(fmt.red(`Clipboard image failed: ${errorMessage(err)}`));
    process.exit(1);
  }
}

// Default command: start the background watcher, or report it's already up.
function startCmd(opts: { dir: string }): void {
  const res = startDaemon(opts.dir);
  if (res.started) {
    console.log(
      `${fmt.green('✓')} started ${fmt.dim('·')} PID ${fmt.bold(String(res.pid))} ` +
      `${fmt.dim('·')} watching clipboard ${fmt.dim(`→ ${opts.dir}`)}`,
    );
    console.log(fmt.dim('  auto-saves new images · `clipimg status` to list · `clipimg stop` to end'));
  } else {
    const store = readStore(opts.dir);
    const up = res.startedAtMs ? humanDuration(Date.now() - res.startedAtMs) : '?';
    const noun = plural(store.count);
    console.log(
      `${fmt.yellow('●')} already running ${fmt.dim('·')} PID ${fmt.bold(String(res.pid))} ` +
      `${fmt.dim('·')} up ${up} ${fmt.dim('·')} ${store.count} ${noun}`,
    );
  }
}

// `stop`: end the background watcher.
function stopCmd(opts: { dir: string }): void {
  const res = stopDaemon(opts.dir);
  if (res.stopped) {
    console.log(`${fmt.green('✓')} stopped ${fmt.dim('·')} PID ${fmt.bold(String(res.pid))}`);
  } else {
    console.log(fmt.yellow('● watcher not running'));
  }
}

// `status` / `ls`: watcher state + what the on-disk store holds.
function showStatus(opts: { dir: string }): void {
  const daemon = readDaemon(opts.dir);
  const store = readStore(opts.dir);
  const now = Date.now();

  console.log();
  console.log(`${fmt.magenta('◆')} ${fmt.bold('clipimg')}  ${fmt.dim('·')}  ${hyperlink(`file://${store.dir}`, fmt.cyan(store.dir))}`);
  if (daemon.running) {
    const up = daemon.startedAtMs ? humanDuration(now - daemon.startedAtMs) : '?';
    console.log(`  ${fmt.green('●')} watcher running ${fmt.dim('·')} PID ${fmt.bold(String(daemon.pid))} ${fmt.dim('·')} up ${up}`);
  } else {
    console.log(`  ${fmt.dim('○ watcher not running — start it by running `clipimg`')}`);
  }
  const noun = plural(store.count);
  const counter = store.counter !== null ? ` ${fmt.dim('·')} ${fmt.dim(`#${store.counter} pastes`)}` : '';
  console.log(`  ${fmt.bold(String(store.count))} ${noun} ${fmt.dim('·')} ${humanSize(store.totalBytes)} on disk${counter}`);

  if (store.count === 0) {
    console.log();
    console.log(fmt.dim('  no saved images yet — copy an image (the watcher auto-saves) or run `clipimg paste`'));
    return;
  }

  console.log();
  const showThumb = terminalSupportsInlineImages(process.stdout);
  store.entries.forEach((e, i) => {
    const idx = fmt.dim(`${i + 1}`.padStart(2));
    // Clickable file:// link — opens the image in the default viewer.
    const name = hyperlink(`file://${e.path}`, fmt.cyan(e.name.replace(/\.png$/, '').slice(0, 12)));
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

// `clear` / `clean`: wipe the on-disk store.
function clearCmd(opts: { dir: string }): void {
  const before = readStore(opts.dir);
  if (before.count === 0) {
    console.log(fmt.yellow(`Store already empty · ${opts.dir}`));
    return;
  }
  const res = clearStore(opts.dir);
  const noun = plural(res.removed);
  console.log(
    `${fmt.green('✓')} Cleared ${fmt.bold(String(res.removed))} ${noun} ` +
    `${fmt.dim('·')} freed ${humanSize(res.freedBytes)} ${fmt.dim('·')} ${fmt.dim(opts.dir)}`,
  );
  console.log(fmt.dim('  paste counter reset to 0'));
}

// `logs`: the watcher's activity log — stored plain on disk, colorized here.
function logsCmd(opts: { dir: string }): void {
  const lines = readDaemonLog(opts.dir);
  if (lines.length === 0) {
    console.log(fmt.yellow(`No watcher log yet · ${opts.dir}`));
    return;
  }
  for (const line of lines) {
    const m = line.match(/^(\[[^\]]+\])\s?(.*)$/); // "[timestamp] message"
    const ts = m ? fmt.dim(m[1]) : '';
    const msg = m ? m[2] : line;
    const paint = /failed|error/i.test(msg) ? fmt.red
      : /saved/i.test(msg) ? fmt.green
      : /readable again|started/i.test(msg) ? fmt.cyan
      : /stop/i.test(msg) ? fmt.yellow
      : fmt.gray;
    console.log(`${ts} ${paint(msg)}`.trim());
  }
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

function runCli(argv: string[]): void {
  // Rich figlet help for a top-level `help`, `-h`, or `--help`; subcommand flags
  // (e.g. `clipimg paste --help`) fall through to commander.
  if (argv[0] === 'help' || argv[0] === '-h' || argv[0] === '--help') {
    showHelp();
    process.exit(0);
  }

  const program = new Command();

  // `-d` is defined on the root (with the default) and, without a default, on each
  // subcommand — so `optsWithGlobals()` resolves it whether it's placed before the
  // command (`clipimg -d X status`) or after it (`clipimg status -d X`), and the
  // subcommand never shadows the global with a default of its own.
  const subDir = (cmd: Command): { dir: string } => ({ dir: cmd.optsWithGlobals().dir as string });

  program
    .name('clipimg')
    .description('Watch the clipboard and auto-save images; `paste` captures one and prints its path')
    .version(getVersion(), '-v, --version')
    .option('-d, --dir <path>', 'store directory', DEFAULT_OUTPUT_DIR)
    .action((opts: { dir: string }) => startCmd(opts));

  program
    .command('paste')
    .alias('grab')
    .description('Capture the clipboard image once and print its path')
    .option('-d, --dir <path>', 'store directory')
    .option('-q, --quiet', 'suppress the staged UI and preview; print only the path')
    .action((_opts: unknown, cmd: Command) => {
      const o = cmd.optsWithGlobals();
      capture({ dir: o.dir as string, quiet: o.quiet as boolean | undefined });
    });

  program
    .command('stop')
    .description('Stop the clipboard watcher')
    .option('-d, --dir <path>', 'store directory')
    .action((_opts: unknown, cmd: Command) => stopCmd(subDir(cmd)));

  program
    .command('status')
    .aliases(['ls', 'list'])
    .description('Show the watcher state and the saved-image store')
    .option('-d, --dir <path>', 'store directory')
    .action((_opts: unknown, cmd: Command) => showStatus(subDir(cmd)));

  program
    .command('logs')
    .description('Show the watcher activity log (colorized)')
    .option('-d, --dir <path>', 'store directory')
    .action((_opts: unknown, cmd: Command) => logsCmd(subDir(cmd)));

  program
    .command('clear')
    .alias('clean')
    .description('Delete every saved image and reset the paste counter')
    .option('-d, --dir <path>', 'store directory')
    .action((_opts: unknown, cmd: Command) => clearCmd(subDir(cmd)));

  program
    .command('doctor')
    .alias('deps')
    .description('Check the clipboard tools this platform needs')
    .action(() => doctorCmd());

  // A usage error — unknown command, unknown/invalid flag, or a missing value —
  // shows the full help and exits non-zero. `-h`/`--help`/`help` (handled above)
  // and `-v`/`--version` exit 0. Bare `clipimg` runs the default (start) action.
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} }); // we print our own help instead

  const CLEAN_EXIT = new Set(['commander.help', 'commander.helpDisplayed', 'commander.version']);
  try {
    program.parse(process.argv);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? '';
    if (CLEAN_EXIT.has(code)) process.exit((err as { exitCode?: number }).exitCode ?? 0);
    showHelp();
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args[0] === '__watch') {
  // Internal entry: the detached child spawned by `startDaemon` runs the loop.
  runWatchLoop(args[1] || DEFAULT_OUTPUT_DIR);
} else {
  runCli(args);
}
