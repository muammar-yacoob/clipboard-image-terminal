/**
 * Background clipboard watcher.
 *
 * Run bare `clipimg` to start a detached daemon that polls the clipboard and
 * auto-saves every new image into the store (default /tmp/clipboard-images).
 * Running it again reports the existing daemon; `clipimg stop` ends it. A one-off
 * capture that prints a path is still available via `clipimg paste`.
 *
 * State is a single `.daemon.pid` file in the store dir holding "<pid> <startedAtMs>",
 * and the watcher appends activity to `.daemon.log`.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { compressImage, DEFAULT_OUTPUT_DIR, readClipboardImage, saveImage } from './clipboard';

const PID_FILE = '.daemon.pid';
const LOG_FILE = '.daemon.log';
const POLL_MS = 2000;

/** Current daemon state derived from the pid file. */
export type DaemonState = { running: boolean; pid: number | null; startedAtMs: number | null };

export type StartResult =
  | { started: true; pid: number }
  | { started: false; pid: number; startedAtMs: number | null }; // already running

export type StopResult = { stopped: boolean; pid: number | null };

const pidPath = (dir: string): string => join(dir, PID_FILE);
const logPath = (dir: string): string => join(dir, LOG_FILE);

// A process with this pid exists? kill(pid, 0) sends no signal; it throws ESRCH
// when the process is gone and EPERM when it exists but isn't ours (still alive).
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

/** Read the pid file and confirm the process is actually alive. */
export function readDaemon(dir: string = DEFAULT_OUTPUT_DIR): DaemonState {
  try {
    const [pidStr, startedStr] = readFileSync(pidPath(dir), 'utf8').trim().split(/\s+/);
    const pid = Number.parseInt(pidStr, 10);
    const startedAtMs = Number.parseInt(startedStr, 10);
    if (Number.isFinite(pid) && isAlive(pid)) {
      return { running: true, pid, startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null };
    }
  } catch { /* no pid file, or unreadable — treat as not running */ }
  return { running: false, pid: null, startedAtMs: null };
}

/**
 * Ensure the watcher is running. Returns `{ started: true }` when a new daemon
 * was spawned, or `{ started: false }` with the existing pid when one was
 * already alive. `scriptPath` is the CLI entry the child re-runs in `__watch`
 * mode (defaults to this process's own script).
 */
export function startDaemon(
  dir: string = DEFAULT_OUTPUT_DIR,
  scriptPath: string = resolve(process.argv[1]),
): StartResult {
  const state = readDaemon(dir);
  if (state.running && state.pid) {
    return { started: false, pid: state.pid, startedAtMs: state.startedAtMs };
  }

  mkdirSync(dir, { recursive: true });
  const logFd = openSync(logPath(dir), 'a');
  const child = spawn(process.execPath, [scriptPath, '__watch', dir], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  const pid = child.pid ?? 0;
  writeFileSync(pidPath(dir), `${pid} ${Date.now()}\n`);
  return { started: true, pid };
}

/** Stop the watcher (SIGTERM) and remove the pid file. */
export function stopDaemon(dir: string = DEFAULT_OUTPUT_DIR): StopResult {
  const state = readDaemon(dir);
  if (!state.running || !state.pid) {
    try { unlinkSync(pidPath(dir)); } catch { /* nothing to clean */ }
    return { stopped: false, pid: null };
  }
  try { process.kill(state.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { unlinkSync(pidPath(dir)); } catch { /* best effort */ }
  return { stopped: true, pid: state.pid };
}

/**
 * The long-running watch loop (runs in the detached child). Polls the clipboard
 * every {@link POLL_MS} and saves any newly-seen image. Errors (e.g. clipboard
 * tool missing, WSL interop down) are logged once per outage, not every tick, so
 * the log stays readable. Exits cleanly on SIGTERM/SIGINT.
 */
export function runWatchLoop(dir: string = DEFAULT_OUTPUT_DIR): void {
  mkdirSync(dir, { recursive: true });
  const log = (msg: string): void => {
    try { appendFileSync(logPath(dir), `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ }
  };
  log(`watcher started (pid ${process.pid}, polling every ${POLL_MS}ms → ${dir})`);

  let lastHash: string | null = null;
  let erroring = false;
  let stopped = false;

  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    log('watcher stopping');
    try { unlinkSync(pidPath(dir)); } catch { /* stop may have removed it already */ }
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  const tick = (): void => {
    try {
      const raw = readClipboardImage();
      if (erroring) { log('clipboard readable again'); erroring = false; }
      if (!raw) return;
      // Hash the raw bytes so re-reading an unchanged clipboard is a cheap no-op
      // (skips recompressing/rehashing). saveImage still dedups on disk.
      const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
      if (hash === lastHash) return;
      lastHash = hash;
      const filePath = saveImage(compressImage(raw), dir);
      log(`saved ${filePath}`);
    } catch (err: unknown) {
      if (!erroring) {
        erroring = true;
        log(`clipboard read failed: ${(err as Error).message}`);
      }
    }
  };

  setInterval(tick, POLL_MS); // keeps the event loop alive
  tick(); // poll once immediately
}
