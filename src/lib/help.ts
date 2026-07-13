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
    fmt.dim('  clipimg runs once and exits — there is no daemon to start/stop and it uses'),
  );
  console.log(
    fmt.dim('  no RAM between runs. Saved images live on disk (the "store"); manage them below.'),
  );
  console.log();
  console.log(head('  Commands'));
  console.log(`    ${pad(cmd('(default)'), 23)}Save the clipboard image and print its path`);
  console.log(`    ${pad(`${cmd('status')} ${fmt.dim('(ls)')}`, 23)}Show the store: image count, disk size, and each image`);
  console.log(`    ${pad(`${cmd('clear')} ${fmt.dim('(clean)')}`, 23)}Delete all saved images and reset the counter`);
  console.log(`    ${pad(`${cmd('doctor')} ${fmt.dim('(deps)')}`, 23)}Check the clipboard tools this platform needs`);
  console.log(`    ${pad(cmd('help'), 23)}Show this help screen`);
  console.log();
  console.log(head('  Options'));
  console.log(`    ${opt('-d, --dir <path>')}       Store directory ${fmt.dim(`(default: ${DEFAULT_OUTPUT_DIR})`)}`);
  console.log(`    ${opt('-q, --quiet')}            Print only the path ${fmt.dim('(no staged UI or preview)')}`);
  console.log(`    ${opt('-v, --version')}          Print version`);
  console.log(`    ${opt('-h, --help')}             Show help`);
  console.log();
  console.log(head('  Examples'));
  console.log(`    ${$} clipimg                          ${comment('# save clipboard image, print its path')}`);
  console.log(`    ${$} claude "look at $(clipimg)"      ${comment('# feed the image to an AI tool')}`);
  console.log(`    ${$} clipimg ${cmd('status')}                   ${comment('# list saved images + total size')}`);
  console.log(`    ${$} clipimg ${cmd('clear')}                    ${comment('# wipe the store')}`);
  console.log(`    ${$} clipimg ${cmd('doctor')}                   ${comment('# are my clipboard tools installed?')}`);
  console.log();
  console.log(head('  Requirements'));
  console.log(`    ${cmd('WSL / Windows')}   powershell.exe ${fmt.dim('(built in — nothing to install)')}`);
  console.log(`    ${cmd('macOS')}           osascript ${fmt.dim('(built in)')} or pngpaste`);
  console.log(`    ${cmd('Linux')}           wl-clipboard ${fmt.dim('(Wayland)')} or xclip ${fmt.dim('(X11)')} — run ${cmd('clipimg doctor')}`);
  console.log();
  console.log(fmt.dim('  Tip: inside VS Code, install the companion extension and press Ctrl+Alt+V'));
  console.log(fmt.dim('       to paste the image path straight into the terminal.'));
}
