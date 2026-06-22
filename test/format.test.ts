import { describe, test, expect } from 'bun:test';
import { humanSize } from '../src/lib/format';

describe('humanSize', () => {
  test('zero', () => expect(humanSize(0)).toBe('0 B'));
  test('bytes', () => expect(humanSize(512)).toBe('512 B'));
  test('kilobytes', () => expect(humanSize(1536)).toBe('1.5 KB'));
  test('megabytes', () => expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB'));
  test('caps at GB', () => expect(humanSize(3 * 1024 ** 3)).toBe('3.0 GB'));
});
