import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDaemon, stopDaemon } from '../src/lib/daemon';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'clipimg-daemon-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('readDaemon', () => {
  test('no pid file → not running', () => {
    expect(readDaemon(tmp())).toEqual({ running: false, pid: null, startedAtMs: null });
  });

  test('a live pid → running, with pid and startedAt', () => {
    const d = tmp();
    const started = 1_700_000_000_000;
    // This test process is definitely alive, so use its own pid.
    writeFileSync(join(d, '.daemon.pid'), `${process.pid} ${started}\n`);
    expect(readDaemon(d)).toEqual({ running: true, pid: process.pid, startedAtMs: started });
  });

  test('a dead pid → not running', () => {
    const d = tmp();
    writeFileSync(join(d, '.daemon.pid'), '2147483646 123\n'); // no process holds this pid
    expect(readDaemon(d).running).toBe(false);
  });
});

describe('stopDaemon', () => {
  test('nothing running → stopped:false', () => {
    expect(stopDaemon(tmp())).toEqual({ stopped: false, pid: null });
  });
});
