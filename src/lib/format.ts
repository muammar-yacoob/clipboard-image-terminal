/** Human-readable byte size, e.g. "42.0 KB". */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

/** Width/height of one vision patch in pixels — Claude bills one token per patch. */
export const PATCH_PX = 28;

/**
 * Estimate the vision tokens an image costs. Claude reads images in 28×28px
 * patches and charges one token each, so cost depends only on pixel dimensions —
 * not file format or byte size. See platform.claude.com/docs/.../vision.
 */
export function estimateImageTokens(width: number, height: number): number {
  return Math.ceil(width / PATCH_PX) * Math.ceil(height / PATCH_PX);
}
