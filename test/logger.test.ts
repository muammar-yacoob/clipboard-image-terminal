import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { fmt } from '../src/lib/logger';

// `colorEnabled` is captured from NO_COLOR at module load, so the color-on cases
// only hold when the test env itself has color enabled.
const colorOn = !process.env.NO_COLOR;

describe('fmt (color on)', () => {
  test.skipIf(!colorOn)('wraps text in an ANSI sequence and resets', () => {
    expect(fmt.red('x')).toBe('\x1b[31mx\x1b[0m');
    expect(fmt.blue('x')).toBe('\x1b[34mx\x1b[0m');
  });

  test.skipIf(!colorOn)('rgb emits a 24-bit color sequence', () => {
    expect(fmt.rgb(1, 2, 3, 'x')).toBe('\x1b[38;2;1;2;3mx\x1b[0m');
  });
});

describe('NO_COLOR', () => {
  test('disables every fmt helper, leaving text untouched', () => {
    // A fresh process so the module re-reads the env with NO_COLOR set.
    const logger = join(import.meta.dir, '../src/lib/logger.ts');
    const script = `import(${JSON.stringify(logger)}).then((m) => `
      + `process.stdout.write(m.fmt.red('x') + m.fmt.rgb(1, 2, 3, 'y') + m.fmt.bold('z')))`;
    const res = Bun.spawnSync({ cmd: ['bun', '-e', script], env: { ...process.env, NO_COLOR: '1' } });
    const out = res.stdout.toString();

    expect(out).toBe('xyz');
    expect(out).not.toContain('\x1b');
  });
});
