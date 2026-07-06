import { printBanner } from './banner';
import { fmt } from './logger';
import { DEFAULT_OUTPUT_DIR } from './clipboard';

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
  console.log(head('  Commands'));
  console.log(`    ${cmd('(default)')}              Save clipboard image and print its path`);
  console.log(`    ${cmd('help')}                   Show this help screen`);
  console.log();
  console.log(head('  Options'));
  console.log(`    ${opt('-d, --dir <path>')}       Output directory ${fmt.dim(`(default: ${DEFAULT_OUTPUT_DIR})`)}`);
  console.log(`    ${opt('-q, --quiet')}            Print only the path ${fmt.dim('(no staged UI or preview)')}`);
  console.log(`    ${opt('-v, --version')}          Print version`);
  console.log(`    ${opt('-h, --help')}             Show help`);
  console.log();
  console.log(head('  Examples'));
  console.log(`    ${$} clipimg                          ${comment('# print saved image path')}`);
  console.log(`    ${$} claude "look at $(clipimg)"      ${comment('# feed the image to an AI tool')}`);
  console.log(`    ${$} clipimg ${opt('-d ./shots')}              ${comment('# save into ./shots')}`);
  console.log();
  console.log(head('  Requirements'));
  console.log(`    ${cmd('WSL / Windows')}   powershell.exe ${fmt.dim('(default on all installs)')}`);
  console.log(`    ${cmd('macOS')}           osascript ${fmt.dim('(built-in)')} or pngpaste`);
  console.log(`    ${cmd('Linux')}           wl-clipboard ${fmt.dim('(Wayland)')} or xclip ${fmt.dim('(X11)')}`);
  console.log();
  console.log(fmt.dim('  Tip: inside VS Code, install the companion extension and press Ctrl+Alt+V'));
  console.log(fmt.dim('       to paste the image path straight into the terminal.'));
}
