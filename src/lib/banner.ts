import figlet from 'figlet';
import { fmt } from './logger';

// Vivid RGB rainbow colors (one per line)
const lineColors = [
  [255, 100, 100], // Bright Red
  [255, 200, 80],  // Orange/Yellow
  [100, 255, 100], // Bright Green
  [100, 200, 255], // Bright Cyan
  [180, 130, 255], // Purple
];

/** Apply vivid rainbow colors (one color per line) */
function applyRainbow(text: string): string {
  const lines = text.split('\n').filter((line) => line.trim());
  return lines
    .map((line, i) => {
      const [r, g, b] = lineColors[i % lineColors.length];
      return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`;
    })
    .join('\n');
}

/** Generate the ClipImg ASCII art banner */
export function getBanner(): string {
  const ascii = figlet.textSync('ClipImg', {
    font: 'Slant',
    horizontalLayout: 'default',
  });
  return applyRainbow(ascii);
}

/** Print the banner to the console */
export function printBanner(): void {
  console.log(getBanner());
  console.log(fmt.dim('  Paste clipboard images as file paths — built for AI coding tools\n'));
}
