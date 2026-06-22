import { describe, test, expect, afterEach } from 'bun:test';
import {
  mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveImage } from '../src/lib/clipboard';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG magic bytes

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
