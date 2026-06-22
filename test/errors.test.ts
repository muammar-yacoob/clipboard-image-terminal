import { describe, test, expect } from 'bun:test';
import { errorMessage } from '../src/lib/errors';

describe('errorMessage', () => {
  test('Error → its message', () => expect(errorMessage(new Error('boom'))).toBe('boom'));
  test('string → itself', () => expect(errorMessage('nope')).toBe('nope'));
  test('object → String()', () => expect(errorMessage({ a: 1 })).toBe('[object Object]'));
  test('null → "null"', () => expect(errorMessage(null)).toBe('null'));
});
