import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readStore, clearStore } from '../src/lib/store';
import { saveImage, bumpPasteCounter } from '../src/lib/clipboard';

// A minimal PNG: signature + IHDR length/type + width + height.
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'clipimg-store-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('readStore', () => {
  test('empty (or missing) dir → zeroed summary', () => {
    const s = readStore(join(tmp(), 'does-not-exist'));
    expect(s).toMatchObject({ count: 0, totalBytes: 0, counter: null });
    expect(s.entries).toEqual([]);
  });

  test('counts images, sums bytes, and reads dimensions from the header', () => {
    const d = tmp();
    saveImage(pngHeader(1024, 768), d);
    const s = readStore(d);
    expect(s.count).toBe(1);
    expect(s.totalBytes).toBe(24);
    expect(s.entries[0]).toMatchObject({ width: 1024, height: 768 });
    expect(s.entries[0].tokens).toBeGreaterThan(0);
  });

  test('reports the persisted paste counter', () => {
    const d = tmp();
    bumpPasteCounter(d);
    bumpPasteCounter(d);
    expect(readStore(d).counter).toBe(2);
  });

  test('sorts entries newest-first by mtime', () => {
    const d = tmp();
    const older = saveImage(pngHeader(100, 100), d);
    const newer = saveImage(pngHeader(200, 200), d);
    // Backdate the first file so ordering is deterministic.
    const past = Date.now() / 1000 - 3600;
    utimesSync(older, past, past);
    const s = readStore(d);
    expect(s.entries[0].path).toBe(newer);
    expect(s.entries[1].path).toBe(older);
  });
});

describe('clearStore', () => {
  test('removes every image and reports freed bytes', () => {
    const d = tmp();
    saveImage(pngHeader(100, 100), d);
    saveImage(pngHeader(200, 200), d);
    const res = clearStore(d);
    expect(res.removed).toBe(2);
    expect(res.freedBytes).toBe(48);
    expect(readStore(d).count).toBe(0);
  });

  test('resets the paste counter', () => {
    const d = tmp();
    bumpPasteCounter(d);
    clearStore(d);
    expect(existsSync(join(d, '.paste-count'))).toBe(false);
    expect(bumpPasteCounter(d)).toBe(1); // numbering starts over
  });

  test('empty store → nothing removed', () => {
    expect(clearStore(tmp())).toEqual({ removed: 0, freedBytes: 0 });
  });
});
