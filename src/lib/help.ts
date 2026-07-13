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
    fmt.dim('  Run bare `clipimg` to start a background watcher that auto-saves clipboard'),
  );
  console.log(
    fmt.dim('  images to the store. Use `paste` for a one-off capture that prints a path.'),
  );
  console.log();
  console.log(head('  Commands'));
  console.log(`    ${pad(cmd('(default)'), 23)}Start the clipboard watcher (or report it's running)`);
  console.log(`    ${pad(`${cmd('paste')} ${fmt.dim('(grab)')}`, 23)}Capture the clipboard image once and print its path`);
  console.log(`    ${pad(cmd('stop'), 23)}Stop the clipboard watcher`);
  console.log(`    ${pad(`${cmd('status')} ${fmt.dim('(ls)')}`, 23)}Show watcher state + the saved-image store`);
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
  console.log(ex('clipimg', '# start the background watcher'));
  console.log(ex(`clipimg ${cmd('paste')}`, '# capture once, print the path'));
  console.log(ex(`claude "look at $(clipimg ${cmd('paste')})"`, '# feed the image to an AI tool'));
  console.log(ex(`clipimg ${cmd('status')}`, '# watcher state + saved images'));
  console.log(ex(`clipimg ${cmd('stop')}`, '# stop the watcher'));
  console.log();
  console.log(head('  Requirements'));
  console.log(`    ${cmd('WSL / Windows')}   powershell.exe ${fmt.dim('(built in — nothing to install)')}`);
  console.log(`    ${cmd('macOS')}           osascript ${fmt.dim('(built in)')} or pngpaste`);
  console.log(`    ${cmd('Linux')}           wl-clipboard ${fmt.dim('(Wayland)')} or xclip ${fmt.dim('(X11)')} — run ${cmd('clipimg doctor')}`);
  console.log();
  console.log(fmt.dim('  Tip: inside VS Code, install the companion extension and press Ctrl+Alt+V'));
  console.log(fmt.dim('       to paste the image path straight into the terminal.'));
}
