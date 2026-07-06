import { describe, test, expect, afterEach } from 'bun:test';
import type { WriteStream } from 'node:tty';
import { terminalSupportsInlineImages, inlineImage } from '../src/lib/thumbnail';

// A stand-in for a TTY stream — only `isTTY` is read by the detector.
const fakeTty = (isTTY: boolean) => ({ isTTY }) as unknown as WriteStream;

// Snapshot and restore the env keys the detector inspects, so cases don't leak.
const ENV_KEYS = ['TERM_PROGRAM', 'TERM', 'TMUX'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

describe('terminalSupportsInlineImages', () => {
  test.each(['vscode', 'iTerm.app', 'WezTerm'])('supports %s', (term) => {
    setEnv({ TERM_PROGRAM: term });
    expect(terminalSupportsInlineImages(fakeTty(true))).toBe(true);
  });

  test.each(['Apple_Terminal', 'xterm', ''])('rejects unknown terminal %p', (term) => {
    setEnv({ TERM_PROGRAM: term });
    expect(terminalSupportsInlineImages(fakeTty(true))).toBe(false);
  });

  test('rejects a non-TTY stream even on a supported terminal', () => {
    setEnv({ TERM_PROGRAM: 'vscode' });
    expect(terminalSupportsInlineImages(fakeTty(false))).toBe(false);
  });

  test('rejects under tmux (needs passthrough we do not emit)', () => {
    setEnv({ TERM_PROGRAM: 'vscode', TMUX: '/tmp/tmux-sock' });
    expect(terminalSupportsInlineImages(fakeTty(true))).toBe(false);
  });

  test('rejects a screen/tmux $TERM', () => {
    setEnv({ TERM_PROGRAM: 'vscode', TERM: 'screen-256color' });
    expect(terminalSupportsInlineImages(fakeTty(true))).toBe(false);
  });
});

describe('inlineImage', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  test('wraps the payload in an OSC 1337 File sequence', () => {
    const seq = inlineImage(png);
    expect(seq.startsWith('\x1b]1337;File=')).toBe(true);
    expect(seq.endsWith('\x07')).toBe(true);
  });

  test('embeds the base64 bytes, byte size, and default box', () => {
    const seq = inlineImage(png);
    expect(seq).toContain(png.toString('base64'));
    expect(seq).toContain(`size=${png.length}`);
    expect(seq).toContain('width=30;height=10');
    expect(seq).toContain('preserveAspectRatio=1');
  });

  test('honors a custom box', () => {
    expect(inlineImage(png, { cols: 12, rows: 4 })).toContain('width=12;height=4');
  });
});
