/**
 * Environment check for the current platform's clipboard backend.
 *
 * `clipimg` shells out to a native tool to read the clipboard because there is
 * no cross-platform, built-in way to do it from Node:
 *   - WSL / Windows : powershell.exe (+ .NET) — always present on Windows
 *   - macOS         : osascript (built-in); sips (built-in) resizes
 *   - Linux         : wl-paste / xclip — NOT built in; must be installed
 *
 * It deliberately does NOT auto-install system packages (that needs root, varies
 * per distro, and is a footgun for an npm/VS Code package). Instead `doctor`
 * reports what's present and, for anything missing, how to get it.
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { detectPlatform, type Platform } from './clipboard';

export type ToolStatus = 'ok' | 'broken' | 'missing';

export type ToolCheck = {
  role: string; // what it's for, e.g. "clipboard reader"
  name: string; // the executable, e.g. "wl-paste"
  required: boolean; // false = optional (a fallback exists / feature degrades)
  status: ToolStatus;
  hint?: string; // how to install or fix, shown when not "ok"
};

export type DoctorReport = {
  platform: Platform;
  checks: ToolCheck[];
  ok: boolean; // true when capture is available (a required reader works)
  active: string | null; // the reader clipimg will actually use, or null if none
};

// Look for an executable on PATH without running it — safe for tools like xclip
// that would block on stdin if invoked bare.
function onPath(bin: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    try {
      if (statSync(join(dir, bin)).isFile()) return true;
    } catch { /* not in this dir */ }
  }
  return false;
}

// Actually run a benign `exit 0` and classify the outcome. Used only for
// powershell.exe, where "present on PATH" isn't enough: with WSL interop down,
// the .exe is visible but can't execute — it fails to exit 0. A broken handler
// surfaces as a non-zero exit status (2) with no error `code`, NOT as ENOEXEC,
// so treat any throw here (other than "not found") as broken.
function runsOk(bin: string, args: string[]): ToolStatus {
  try {
    execFileSync(bin, args, { stdio: 'ignore', timeout: 4000 });
    return 'ok';
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ENOENT') return 'missing';
    return 'broken'; // present but couldn't run cleanly — e.g. WSL interop not registered
  }
}

function checkPowerShell(): ToolCheck {
  const base = { role: 'clipboard reader + resizer', name: 'powershell.exe', required: true };
  if (!onPath('powershell.exe')) {
    return {
      ...base,
      status: 'missing',
      hint: 'powershell.exe is not on PATH — set appendWindowsPath=true under [interop] in /etc/wsl.conf.',
    };
  }
  const status = runsOk('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
  if (status === 'broken') {
    return {
      ...base,
      status,
      hint: "WSL Windows-interop is not registered (every .exe fails with \"exec format error\"). Fix: run `wsl --shutdown` from Windows and reopen, or re-register with `echo ':WSLInterop:M::MZ::/init:PF' | sudo tee /proc/sys/fs/binfmt_misc/register`.",
    };
  }
  return { ...base, status };
}

function checkLinux(): ToolCheck[] {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  const x11 = Boolean(process.env.DISPLAY);
  const checks: ToolCheck[] = [];

  // The session-appropriate reader is required; the other is a nice-to-have.
  const wlRequired = wayland || !x11; // Wayland session, or unknown
  const xRequired = x11 || !wayland; // X11 session, or unknown

  checks.push({
    role: 'clipboard reader (Wayland)',
    name: 'wl-paste',
    required: wlRequired && !x11,
    status: onPath('wl-paste') ? 'ok' : 'missing',
    hint: 'Install wl-clipboard — e.g. `sudo apt install wl-clipboard` (or your distro\'s package manager).',
  });
  checks.push({
    role: 'clipboard reader (X11)',
    name: 'xclip',
    required: xRequired && !wayland,
    status: onPath('xclip') ? 'ok' : 'missing',
    hint: 'Install xclip — e.g. `sudo apt install xclip` (or your distro\'s package manager).',
  });
  checks.push({
    role: 'image resizer (optional — token-saving downscale)',
    name: 'magick / convert',
    required: false,
    status: onPath('magick') || onPath('convert') ? 'ok' : 'missing',
    hint: 'Install ImageMagick — e.g. `sudo apt install imagemagick`. Without it, images paste at full size (more tokens).',
  });
  return checks;
}

function checkMac(): ToolCheck[] {
  return [
    {
      role: 'clipboard reader',
      name: 'osascript',
      required: true,
      status: onPath('osascript') ? 'ok' : 'missing',
      hint: 'osascript ships with macOS — a missing one points to a broken PATH.',
    },
    {
      role: 'image resizer',
      name: 'sips',
      required: false,
      status: onPath('sips') ? 'ok' : 'missing',
      hint: 'sips ships with macOS; alternatively install ImageMagick (`brew install imagemagick`).',
    },
    {
      role: 'clipboard reader (optional fallback)',
      name: 'pngpaste',
      required: false,
      status: onPath('pngpaste') ? 'ok' : 'missing',
      hint: 'Optional — `brew install pngpaste`. osascript already covers the common case.',
    },
  ];
}

// The WSLg fallback reader — present AND actually able to connect to the display
// (not just on PATH: WSLg needs WAYLAND_DISPLAY/XDG_RUNTIME_DIR to read).
function checkWslgFallback(active: boolean): ToolCheck {
  const bin = onPath('wl-paste') ? 'wl-paste' : onPath('xclip') ? 'xclip' : null;
  let status: ToolStatus = 'missing';
  if (bin) {
    const args = bin === 'wl-paste'
      ? ['--list-types']
      : ['-selection', 'clipboard', '-t', 'TARGETS', '-o'];
    try {
      execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 4000 });
      status = 'ok';
    } catch (err: unknown) {
      const stderr = String((err as { stderr?: Buffer | string }).stderr ?? '');
      // A display/connection error means it can't read; anything else (e.g. an
      // empty clipboard) means it connected fine.
      status = /failed to connect|not set in the environment|can't open display/i.test(stderr)
        ? 'broken' : 'ok';
    }
  }
  return {
    name: 'wl-paste / xclip',
    role: active ? 'clipboard reader (via WSLg)' : 'WSLg fallback (used if interop is down)',
    required: active,
    status,
    hint: status === 'missing'
      ? 'Install wl-clipboard (or xclip) so clipimg can read the clipboard via WSLg.'
      : status === 'broken'
        ? "wl-paste can't reach the display — make sure WAYLAND_DISPLAY and XDG_RUNTIME_DIR are set (WSLg sets these automatically)."
        : undefined,
  };
}

function checkWsl(): ToolCheck[] {
  const ps = checkPowerShell();
  const hasWslg = Boolean(process.env.WAYLAND_DISPLAY || process.env.DISPLAY);

  // PowerShell works → it's the active path; WSLg is just a bonus.
  if (ps.status === 'ok') {
    const checks: ToolCheck[] = [ps];
    if (hasWslg) checks.push(checkWslgFallback(false));
    return checks;
  }

  // PowerShell can't run. If WSLg covers it, lead with WSLg (active) and demote
  // PowerShell to a dim, optional note — no alarming ✗ or "fix interop" wall,
  // since capture already works.
  if (hasWslg) {
    const fallback = checkWslgFallback(true);
    if (fallback.status === 'ok') {
      return [
        fallback,
        {
          name: 'powershell.exe',
          role: 'optional — Windows interop is down, but WSLg covers it',
          required: false,
          status: ps.status,
          hint: undefined, // capture already works; no need to nag about interop
        },
      ];
    }
    return [ps, fallback]; // WSLg present but not working — show both problems
  }

  return [ps];
}

/** Probe the current platform's clipboard tools and report their status. */
export function runDoctor(): DoctorReport {
  const platform = detectPlatform();
  let checks: ToolCheck[];
  switch (platform) {
    case 'windows':
      checks = [checkPowerShell()];
      break;
    case 'wsl':
      checks = checkWsl();
      break;
    case 'macos':
      checks = checkMac();
      break;
    case 'linux':
      checks = checkLinux();
      break;
  }
  // On WSL, capture works if EITHER PowerShell or the WSLg fallback works.
  const ok = platform === 'wsl'
    ? checks.some((c) => c.status === 'ok')
    : checks.every((c) => !c.required || c.status === 'ok');
  const reader = ok ? checks.find((c) => c.status === 'ok') : undefined;
  const active = reader
    ? (reader.name.includes('wl-paste') ? 'WSLg (wl-paste)' : reader.name)
    : null;
  return { platform, checks, ok, active };
}
