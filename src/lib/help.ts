import { printBanner } from './banner';
import { fmt } from './logger';
import { DEFAULT_OUTPUT_DIR } from './clipboard';

// Visible width of a string, ignoring ANSI color escapes — so colored labels
// (e.g. a cyan command + a dim alias) pad to the right column.
const visibleWidth = (s: string): number => s.replace(/\x1b\[[0-9;]*m/g, '').length;

// Left-align `label` in a fixed-width column, measuring its visible width so the
// following description starts at the same place on every row.
const pad = (label: string, width: number): string =>
  label + ' '.repeat(Math.max(2, width - visibleWidth(label)));

/** Display the custom help screen. */
export function showHelp(): void {
  printBanner();

  const cmd = fmt.cyan;
  const opt = fmt.green;
  const head = fmt.bold;
  const $ = fmt.gray('$');
  const comment = fmt.gray;

  console.log(`  ${head('Usage:')} clipimg ${cmd('[command]')} ${opt('[options]')}`);
  console.log();
  console.log(
    fmt.dim('  Run bare `clipimg` to capture the clipboard image and print its path.'),
  );
  console.log(
    fmt.dim('  Add `watch` to auto-save new images in the background.'),
  );
  console.log();
  console.log(head('  Commands'));
  console.log(`    ${pad(cmd('(default)'), 23)}Save the clipboard image and print its path`);
  console.log(`    ${pad(cmd('watch'), 23)}Start a background watcher that auto-saves images`);
  console.log(`    ${pad(cmd('stop'), 23)}Stop the background watcher`);
  console.log(`    ${pad(`${cmd('status')} ${fmt.dim('(ls)')}`, 23)}Show the store (and watcher state, if running)`);
  console.log(`    ${pad(cmd('logs'), 23)}Show the watcher activity log (with [img #n])`);
  console.log(`    ${pad(`${cmd('clear')} ${fmt.dim('(clean)')}`, 23)}Delete all saved images and reset the counter`);
  console.log(`    ${pad(`${cmd('doctor')} ${fmt.dim('(deps)')}`, 23)}Check the clipboard tools this platform needs`);
  console.log(`    ${pad(cmd('help'), 23)}Show this help screen`);
  console.log();
  console.log(head('  Options'));
  console.log(`    ${opt('-d, --dir <path>')}       Store directory ${fmt.dim(`(default: ${DEFAULT_OUTPUT_DIR})`)}`);
  console.log(`    ${opt('-q, --quiet')}            Print only the path ${fmt.dim('(paste; no staged UI or preview)')}`);
  console.log(`    ${opt('-v, --version')}          Print version`);
  console.log(`    ${opt('-h, --help')}             Show help`);
  console.log();
  console.log(head('  Examples'));
  const ex = (usage: string, note: string): string => `    ${$} ${pad(usage, 36)}${comment(note)}`;
  console.log(ex('clipimg', '# capture clipboard, print the path'));
  console.log(ex(`claude "look at $(clipimg)"`, '# feed the image to an AI tool'));
  console.log(ex(`clipimg ${cmd('watch')}`, '# auto-save new images in the background'));
  console.log(ex(`clipimg ${cmd('logs')}`, '# watcher activity, with [img #n]'));
  console.log(ex(`clipimg ${cmd('stop')}`, '# stop the watcher'));
  console.log();
  console.log(head('  Requirements'));
  console.log(fmt.dim("    clipimg does NOT install these — run `clipimg doctor` to check yours."));
  console.log(`    ${cmd('WSL / Windows')}   powershell.exe ${fmt.dim('— built in')} ${fmt.dim('(WSL fallback: wl-clipboard via WSLg)')}`);
  console.log(`    ${cmd('macOS')}           osascript ${fmt.dim('— built in (pngpaste optional)')}`);
  console.log(`    ${cmd('Linux')}           wl-clipboard ${fmt.dim('(Wayland)')} or xclip ${fmt.dim('(X11)')} ${fmt.dim('— via your package manager')}`);
  console.log();
  console.log(fmt.dim('  Tip: inside VS Code, install the companion extension and press Ctrl+Alt+V'));
  console.log(fmt.dim('       to paste the image path straight into the terminal.'));
}
