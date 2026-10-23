import fs from "node:fs/promises";
import path from "node:path";

const CHROME_CMD_RE = /(?:^|\/)(chrome|chromium|chrome-wrapper)(?:\s|$)/i;

function cmdlineMatchesUserDataDir(cmdline: string, userDataDir: string): boolean {
  const resolved = path.resolve(userDataDir);
  const args = cmdline.split("\0").filter(Boolean);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--user-data-dir" || arg === "--user-data-dir=") {
      const next = args[i + 1];
      if (next && path.resolve(next) === resolved) return true;
      continue;
    }
    if (arg.startsWith("--user-data-dir=")) {
      const value = arg.slice("--user-data-dir=".length);
      if (value && path.resolve(value) === resolved) return true;
    }
  }
  // Fallback: absolute path appears in argv (Playwright sometimes joins oddly).
  return cmdline.includes(`--user-data-dir=${resolved}`) || cmdline.includes(`--user-data-dir=${userDataDir}`);
}

async function listPidsUsingUserDataDir(userDataDir: string): Promise<number[]> {
  let entries: string[];
  try {
    entries = await fs.readdir("/proc");
  } catch {
    return [];
  }
  const pids: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let cmdline: string;
    try {
      cmdline = await fs.readFile(path.join("/proc", entry, "cmdline"), "utf8");
    } catch {
      continue;
    }
    if (!cmdline || !CHROME_CMD_RE.test(cmdline.replace(/\0/g, " "))) continue;
    if (!cmdlineMatchesUserDataDir(cmdline, userDataDir)) continue;
    pids.push(Number(entry));
  }
  return pids;
}

/** True if a Chromium process currently holds this persistent profile. */
export async function isChromeUsingProfile(userDataDir: string): Promise<boolean> {
  const pids = await listPidsUsingUserDataDir(userDataDir);
  return pids.length > 0;
}

/** Remove Chromium Singleton* locks without touching cookies / Default/. */
export async function clearChromeSingletonLocks(userDataDir: string): Promise<void> {
  const lockNames = ["SingletonLock", "SingletonCookie", "SingletonSocket", "RunningChromeVersion"];
  for (const name of lockNames) {
    for (const dir of [userDataDir, path.join(userDataDir, "Default")]) {
      try {
        await fs.rm(path.join(dir, name), { force: true });
      } catch {
        // ignore
      }
    }
  }
}

/**
 * SIGTERM then SIGKILL Chromium processes bound to a user-data-dir.
 * Does not delete the profile (cookies stay). Clears Singleton* afterward.
 */
export async function killChromeForUserDataDir(userDataDir: string): Promise<number> {
  const pids = await listPidsUsingUserDataDir(userDataDir);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
  if (pids.length > 0) {
    await new Promise((r) => setTimeout(r, 1500));
  }
  const remaining = await listPidsUsingUserDataDir(userDataDir);
  for (const pid of remaining) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
  await clearChromeSingletonLocks(userDataDir);
  return pids.length;
}
