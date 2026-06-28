#!/usr/bin/env node
import { Command } from 'commander';
import { captureClipboardImage, DEFAULT_OUTPUT_DIR } from './lib/clipboard';
import { showHelp } from './lib/help';
import { fmt } from './lib/logger';
import { errorMessage } from './lib/errors';

// out/cli.js sits one level below package.json
function getVersion(): string {
  try {
    return require('../package.json').version as string;
  } catch {
    return '0.0.0';
  }
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
  .action((opts: { dir: string }) => {
    try {
      // All logging goes to stderr so stdout stays clean for `claude "$(clipimg)"`.
      const filePath = captureClipboardImage(opts.dir, (event) => {
        if (event.type === 'compressing') {
          console.error(fmt.cyan('[compressing image...]'));
          return;
        }
        let saved = '';
        if (event.savedTokens > 0) {
          const pct = Math.round((event.savedTokens / event.originalTokens) * 100);
          saved = ` ${fmt.green(`↓ saved ~${event.savedTokens} (${pct}%)`)}`;
        }
        console.error(
          `${fmt.magenta('◆')} ${fmt.bold(`~${event.tokens} tokens`)}` +
          `${fmt.dim(` ${event.width}×${event.height}`)}${saved}`,
        );
      });
      if (!filePath) {
        console.error(fmt.yellow('No image on clipboard'));
        process.exit(1);
      }
      // The path goes to stdout so it stays pipeable: `claude "$(clipimg)"`.
      console.log(filePath);
    } catch (err: unknown) {
      console.error(fmt.red(`Clipboard image failed: ${errorMessage(err)}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
