import { describe, test, expect } from 'bun:test';
import { humanSize, humanAge, estimateImageTokens } from '../src/lib/format';

describe('humanSize', () => {
  test('zero', () => expect(humanSize(0)).toBe('0 B'));
  test('bytes', () => expect(humanSize(512)).toBe('512 B'));
  test('kilobytes', () => expect(humanSize(1536)).toBe('1.5 KB'));
  test('megabytes', () => expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB'));
  test('caps at GB', () => expect(humanSize(3 * 1024 ** 3)).toBe('3.0 GB'));
});

describe('humanAge', () => {
  test('seconds', () => expect(humanAge(5_000)).toBe('5s ago'));
  test('minutes', () => expect(humanAge(3 * 60_000)).toBe('3m ago'));
  test('hours', () => expect(humanAge(2 * 3_600_000)).toBe('2h ago'));
  test('days', () => expect(humanAge(4 * 86_400_000)).toBe('4d ago'));
  test('never negative', () => expect(humanAge(-1000)).toBe('0s ago'));
});

describe('estimateImageTokens', () => {
  // One token per 28×28px patch, rounding each axis up — matches Anthropic's docs.
  test('1000×1000 → 1296 (⌈1000/28⌉² = 36²)', () => {
    expect(estimateImageTokens(1000, 1000)).toBe(1296);
  });

  test('1092×1092 → 1521 (39²), the documented example', () => {
    expect(estimateImageTokens(1092, 1092)).toBe(1521);
  });

  test('rounds each axis up independently', () => {
    expect(estimateImageTokens(1, 1)).toBe(1);
    expect(estimateImageTokens(29, 29)).toBe(4); // ⌈29/28⌉² = 2²
  });
});
