#!/usr/bin/env node
import { statSync } from 'node:fs';
import { Command } from 'commander';
import { captureClipboardImage, DEFAULT_OUTPUT_DIR } from './lib/clipboard';
import { showHelp } from './lib/help';
import { fmt } from './lib/logger';
import { errorMessage } from './lib/errors';

/** Human-readable byte size, e.g. 42.0 KB. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

// out/cli.js sits one level below package.json
function getVersion(): string {
  try {
    return require('../package.json').version as string;
  } catch {
    return '0.0.0';
  }
}

// Show the rich figlet help for `help`, `-h`, `--help` (and Windows-style /?).
const argv = process.argv.slice(2);
if (argv[0] === 'help' || argv.includes('-h') || argv.includes('--help') || argv.includes('/?')) {
  showHelp();
  process.exit(0);
}

const program = new Command();

program
  .name('clipimg')
  .description('Save the clipboard image to a file and print its path (WSL, macOS, Linux)')
  .version(getVersion(), '-v, --version')
  .option('-d, --dir <path>', 'output directory', DEFAULT_OUTPUT_DIR)
  .action((opts: { dir: string }) => {
    try {
      const filePath = captureClipboardImage(opts.dir);
      if (!filePath) {
        console.error(fmt.yellow('No image on clipboard'));
        process.exit(1);
      }
      // The path goes to stdout so it stays pipeable: `claude "$(clipimg)"`.
      console.log(filePath);

      // When run interactively (not piped), show a friendly confirmation on
      // stderr — stdout stays clean for command substitution.
      if (process.stdout.isTTY) {
        let size = '';
        try { size = fmt.dim(` (${humanSize(statSync(filePath).size)})`); } catch { /* ignore */ }
        console.error(`${fmt.green('✔')} ${fmt.bold('Image saved')}${size}`);
      }
    } catch (err: unknown) {
      console.error(fmt.red(`Clipboard image failed: ${errorMessage(err)}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
