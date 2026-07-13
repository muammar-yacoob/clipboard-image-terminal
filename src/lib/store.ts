/**
 * Introspection and management for the on-disk image store.
 *
 * `clipimg` is a one-shot CLI, not a daemon — it holds NOTHING in RAM between
 * runs and has no background process to start, stop, or keep alive. Its only
 * persistent state is the PNGs saved in the output dir (default
 * /tmp/clipboard-images), each named by content hash, plus a `.paste-count`
 * file. That directory is the "memory" users want to inspect and clear, so
 * these helpers report and wipe it.
 */
import {
  closeSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_OUTPUT_DIR, pngDimensions } from './clipboard';
import { estimateImageTokens } from './format';

const COUNTER_FILE = '.paste-count';

/** One saved image and its metadata. */
export type StoreEntry = {
  name: string; // file name, e.g. "a1b2c3d4e5f6a7b8.png"
  path: string; // absolute path
  bytes: number; // size on disk
  mtimeMs: number; // when it was saved (epoch ms)
  width: number | null; // pixel width, or null if the header can't be read
  height: number | null;
  tokens: number | null; // estimated vision tokens, or null when dimensions are unknown
};

/** A snapshot of the whole store: totals plus every image, newest first. */
export type StoreSummary = {
  dir: string;
  count: number;
  totalBytes: number;
  counter: number | null; // lifetime paste count from .paste-count, or null if absent
  entries: StoreEntry[];
};

/** Result of {@link clearStore}. */
export type ClearResult = { removed: number; freedBytes: number };

// Read just the first 24 bytes (PNG signature + IHDR) so listing a big store
// never has to slurp every image into memory just to learn its dimensions.
function readPngHeader(path: string): Buffer | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(24);
    const read = readSync(fd, buf, 0, 24, 0);
    return read >= 24 ? buf : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/**
 * Snapshot the store at `dir`: every saved `.png`, sorted newest-first, with the
 * total on-disk size and the lifetime paste counter. A missing/empty dir yields
 * a zeroed summary rather than throwing.
 */
export function readStore(dir: string = DEFAULT_OUTPUT_DIR): StoreSummary {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.png'));
  } catch { /* dir doesn't exist yet — treat as empty */ }

  const entries: StoreEntry[] = [];
  let totalBytes = 0;
  for (const name of names) {
    const path = join(dir, name);
    try {
      const st = statSync(path);
      const header = readPngHeader(path);
      const dims = header ? pngDimensions(header) : null;
      entries.push({
        name,
        path,
        bytes: st.size,
        mtimeMs: st.mtimeMs,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        tokens: dims ? estimateImageTokens(dims.width, dims.height) : null,
      });
      totalBytes += st.size;
    } catch { /* skip anything we can't stat */ }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

  let counter: number | null = null;
  try {
    const n = parseInt(readFileSync(join(dir, COUNTER_FILE), 'utf8'), 10);
    counter = Number.isFinite(n) ? n : null;
  } catch { /* no counter file yet */ }

  return { dir, count: entries.length, totalBytes, counter, entries };
}

/**
 * Delete every saved image in `dir` and reset the paste counter. Best-effort:
 * files that can't be removed are skipped. Returns how many were deleted and how
 * many bytes that freed.
 */
export function clearStore(dir: string = DEFAULT_OUTPUT_DIR): ClearResult {
  let removed = 0;
  let freedBytes = 0;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return { removed, freedBytes }; // nothing to clear
  }

  for (const name of names) {
    if (!name.endsWith('.png')) continue;
    const path = join(dir, name);
    try {
      freedBytes += statSync(path).size;
      unlinkSync(path);
      removed += 1;
    } catch { /* skip files we can't remove */ }
  }

  // Reset the [img #n] counter so a wiped store starts numbering from 1 again.
  try { unlinkSync(join(dir, COUNTER_FILE)); } catch { /* no counter file */ }

  return { removed, freedBytes };
}
