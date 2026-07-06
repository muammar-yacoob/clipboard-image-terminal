import { describe, test, expect, afterEach } from 'bun:test';
import {
  mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveImage, pngDimensions, compressImage,
  needsCompression, summarizePaste, bumpPasteCounter,
} from '../src/lib/clipboard';
import { estimateImageTokens } from '../src/lib/format';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG magic bytes

// A minimal PNG header: signature + length/type bytes + width + height.
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'clipimg-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('saveImage', () => {
  test('saves a .png named by content hash', () => {
    const p = saveImage(PNG, tmp());
    expect(p.endsWith('.png')).toBe(true);
    expect(existsSync(p)).toBe(true);
  });

  test('dedups identical bytes to the same path', () => {
    const d = tmp();
    expect(saveImage(PNG, d)).toBe(saveImage(PNG, d));
    expect(readdirSync(d).length).toBe(1);
  });

  test('different bytes → different files', () => {
    const d = tmp();
    saveImage(PNG, d);
    saveImage(Buffer.from('89504e470d0a1a0aFF', 'hex'), d);
    expect(readdirSync(d).length).toBe(2);
  });

  test('prunes images older than 7 days', () => {
    const d = tmp();
    const old = join(d, 'deadbeefdeadbeef.png');
    writeFileSync(old, PNG);
    const eightDaysAgo = Date.now() / 1000 - 8 * 24 * 3600;
    utimesSync(old, eightDaysAgo, eightDaysAgo);
    saveImage(PNG, d); // triggers prune
    expect(existsSync(old)).toBe(false);
  });
});

describe('pngDimensions', () => {
  test('reads width and height from the IHDR header', () => {
    expect(pngDimensions(pngHeader(2560, 1440))).toEqual({ width: 2560, height: 1440 });
  });

  test('returns null for non-PNG bytes', () => {
    expect(pngDimensions(Buffer.from('ffd8ffe0', 'hex'))).toBeNull(); // JPEG magic
  });
});

describe('compressImage', () => {
  test('leaves images within the token budget untouched and stays quiet', () => {
    const small = pngHeader(800, 600); // 0.48 MP, under the ~1.23 MP budget
    let compressed = false;
    expect(compressImage(small, () => { compressed = true; })).toBe(small);
    expect(compressed).toBe(false);
  });

  test('leaves undecodable bytes untouched', () => {
    expect(compressImage(PNG)).toBe(PNG);
  });

  test('signals compression once when an oversized image is resized', () => {
    const big = pngHeader(4000, 3000); // 12 MP, header only, no pixels
    let calls = 0;
    // Resizing fails on a headers-only PNG, so it falls back to the original
    // buffer — but the compression signal must still fire exactly once.
    compressImage(big, () => { calls += 1; });
    expect(calls).toBe(1);
  });
});

describe('needsCompression', () => {
  test('true for a PNG over the token budget', () => {
    expect(needsCompression(pngHeader(4000, 3000))).toBe(true); // 12 MP
  });

  test('false for a PNG within the budget', () => {
    expect(needsCompression(pngHeader(800, 600))).toBe(false); // 0.48 MP
  });

  test('false for non-PNG bytes', () => {
    expect(needsCompression(Buffer.from('ffd8ffe0', 'hex'))).toBe(false); // JPEG
  });
});

describe('summarizePaste', () => {
  test('reports the saved dimensions and token savings', () => {
    const raw = pngHeader(4000, 3000);   // huge original
    const final = pngHeader(1280, 960);  // after downscale
    const s = summarizePaste(raw, final);
    expect(s).not.toBeNull();
    expect(s).toMatchObject({ width: 1280, height: 960 });
    // Original tokens are capped at the high-res tier ceiling (4784), so a 12 MP
    // source still reports finite savings rather than its raw ~15k estimate.
    expect(s!.originalTokens).toBe(4784);
    expect(s!.tokens).toBe(estimateImageTokens(1280, 960));
    expect(s!.savedTokens).toBe(4784 - s!.tokens);
  });

  test('no savings when the image was left untouched', () => {
    const buf = pngHeader(800, 600);
    const s = summarizePaste(buf, buf);
    expect(s!.savedTokens).toBe(0);
  });

  test('null when the saved bytes are not a PNG', () => {
    expect(summarizePaste(pngHeader(800, 600), Buffer.from('ffd8', 'hex'))).toBeNull();
  });
});

describe('bumpPasteCounter', () => {
  test('starts at 1 and increments, persisting across calls', () => {
    const d = tmp();
    expect(bumpPasteCounter(d)).toBe(1);
    expect(bumpPasteCounter(d)).toBe(2);
    expect(bumpPasteCounter(d)).toBe(3);
  });

  test('counts independently per output directory', () => {
    const a = tmp();
    const b = tmp();
    bumpPasteCounter(a);
    bumpPasteCounter(a);
    expect(bumpPasteCounter(b)).toBe(1); // b is untouched by a's pastes
    expect(bumpPasteCounter(a)).toBe(3);
  });
});
