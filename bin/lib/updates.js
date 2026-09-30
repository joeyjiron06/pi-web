/**
 * Shared update logic for the pi-web CLI and the web server.
 *
 * This module is imported from two very different places:
 *
 *   1. `bin/pi-web.js`, run directly by node from your terminal, and
 *   2. `app/services/updates.server.ts`, which Vite *bundles* into
 *      `build/server/index.js`.
 *
 * Two rules follow from that, and both are load-bearing:
 *
 *   - **No dependencies.** Node builtins only. `pi-web doctor` has to work when
 *     `node_modules` is broken, and a static import of a package would crash
 *     the whole CLI in exactly that situation.
 *   - **No paths derived from `import.meta.url`.** Once bundled, that resolves
 *     to `build/server/`, not the project root. Every exported function takes
 *     `projectDir` explicitly instead.
 *
 * Never import this from a browser module. It is not named `*.server.js`, so
 * Vite will not stop you, and you would end up with `node:child_process` in a
 * client bundle. `app/services/updates.server.ts` is the only web-side caller.
 */

import { exec, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** Every package under this scope is updated together, to the same version. */
const PACKAGE_SCOPE = "@earendil-works/";

/** A registry lookup that takes longer than this is treated as "unavailable". */
const CHECK_TIMEOUT_MS = 10_000;

/** A lock older than this is assumed to belong to a crashed run. */
const LOCK_STALE_MS = 15 * 60_000;

/** Files restored verbatim when an update fails. */
const BACKED_UP_FILES = ["package.json", "pnpm-lock.yaml"];

/**
 * What a token is allowed to look like before it joins a shell command line.
 *
 * Every pnpm call here goes through a shell, because the Windows executable is
 * `pnpm.cmd` and node cannot run a `.cmd` without one. Node 24 deprecates
 * passing a separate args array alongside `shell: true` (DEP0190) precisely
 * because those args are concatenated, not escaped -- so the command line is
 * built by hand and every token is checked first.
 *
 * In practice the tokens are package names from our own package.json and
 * versions from `pnpm view`, so nothing hostile can reach here. This is a
 * tripwire, not a sanitiser: anything unexpected throws rather than being
 * quietly escaped.
 */
const SAFE_TOKEN = /^[@a-zA-Z0-9._/^~-]+$/;

function toCommandLine(args) {
  for (const token of args) {
    if (!SAFE_TOKEN.test(token)) {
      throw new Error(`Refusing to run pnpm with unexpected argument: ${token}`);
    }
  }
  return `pnpm ${args.join(" ")}`;
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

const dataDir = (projectDir) => path.join(projectDir, ".data");
const stateFile = (projectDir) => path.join(dataDir(projectDir), "update-check.json");
const lockFile = (projectDir) => path.join(dataDir(projectDir), "update.lock");
const backupDir = (projectDir) => path.join(dataDir(projectDir), "update-backup");

// ---------------------------------------------------------------------------
// versions
// ---------------------------------------------------------------------------

/**
 * Compare two `major.minor.patch` versions.
 *
 * Deliberately not semver-complete: the only versions that reach this function
 * come from `pnpm view <pkg> version`, which returns the `latest` dist-tag, and
 * by convention that is never a prerelease. Anything unparseable compares
 * equal, so a surprise never turns into a false "update available".
 */
export function compareVersions(a, b) {
  const parse = (value) =>
    String(value ?? "")
      .split("-")[0]
      .split(".")
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10));

  const left = parse(a);
  const right = parse(b);

  for (let index = 0; index < 3; index += 1) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }

  return 0;
}

/** Today in the *local* timezone, as `YYYY-MM-DD`. */
export function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// package discovery
// ---------------------------------------------------------------------------

/**
 * Every `@earendil-works/*` package this project depends on, read from
 * `package.json` on disk.
 *
 * Read at runtime rather than hardcoded or statically imported: an import
 * would freeze the list into the server bundle, and the set of packages is
 * allowed to change.
 */
export function getPiPackages(projectDir) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
    );

    const names = new Set(
      [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ].filter((name) => name.startsWith(PACKAGE_SCOPE)),
    );

    return [...names].sort();
  } catch {
    return [];
  }
}

/** The version actually on disk in `node_modules` -- the truth about what runs. */
export function getInstalledVersion(projectDir, name) {
  try {
    const manifestPath = path.join(
      projectDir,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/**
 * The `latest` dist-tag for one package, or `null` if it cannot be determined.
 *
 * Shells out to pnpm rather than fetching a registry URL. Only pnpm knows
 * which registry applies here -- there is a project `.npmrc` as well as the
 * one in your home directory, and whichever wins also carries the auth token
 * and proxy settings. A hardcoded registry URL would silently report the
 * wrong versions.
 */
async function fetchLatestVersion(projectDir, name) {
  try {
    const { stdout } = await execAsync(toCommandLine(["view", name, "version"]), {
      cwd: projectDir,
      encoding: "utf8",
      timeout: CHECK_TIMEOUT_MS,
      windowsHide: true,
    });

    const line = stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
    return /^\d+\.\d+\.\d+/.test(line) ? line : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// state file
// ---------------------------------------------------------------------------

/**
 * `.data/update-check.json`.
 *
 * `.data/` is gitignored and excluded from vite's watcher, so writing here
 * cannot trigger a dev-server reload. See the note in
 * `app/services/projects.server.ts`.
 *
 * `declined` needs no expiry of its own: when the date rolls over `checkedOn`
 * stops matching, the check re-runs, and the file is rewritten with
 * `declined: false`. One field does both jobs.
 */
export function readState(projectDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(projectDir), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeState(projectDir, state) {
  try {
    fs.mkdirSync(dataDir(projectDir), { recursive: true });
    fs.writeFileSync(
      stateFile(projectDir),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // a cache we cannot write is a cache we re-read from the registry. Not
    // worth failing a command over.
  }
}

export function clearState(projectDir) {
  try {
    fs.rmSync(stateFile(projectDir), { force: true });
  } catch {
    // best effort
  }
}

/** Remember that the answer was "no", so nothing prompts again today. */
export function markDeclined(projectDir) {
  const existing = readState(projectDir);
  if (!existing) return;
  writeState(projectDir, { ...existing, declined: true });
}

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

/**
 * Is there a newer Pi SDK than the one installed?
 *
 * At most one registry round-trip per calendar day; every other call is a file
 * read. Returns `null` when the answer is unknown (offline, expired npm token,
 * no `node_modules`), and **never throws** -- a failed check must not be able
 * to break `pi-web start` or a page load.
 *
 * @param {object} options
 * @param {string} options.projectDir
 * @param {boolean} [options.cachedOnly] never touch the network, however stale
 *   the cache is. Used by `status` and `doctor`, which have to stay instant.
 * @param {boolean} [options.force] ignore the cache and re-check now.
 */
export async function checkForUpdate({
  projectDir,
  cachedOnly = false,
  force = false,
} = {}) {
  try {
    const names = getPiPackages(projectDir);
    if (names.length === 0) return null;

    const today = todayKey();
    const cached = readState(projectDir);
    const cacheIsFresh = Boolean(
      cached && cached.checkedOn === today && cached.latestByName,
    );

    let latestByName;
    let checkedOn;
    let declined;

    if (!force && (cacheIsFresh || cachedOnly)) {
      if (!cached?.latestByName) return null;
      latestByName = cached.latestByName;
      checkedOn = cached.checkedOn;
      // a stale cache carries no opinion about today
      declined = cacheIsFresh ? Boolean(cached.declined) : false;
    } else {
      const looked = await Promise.all(
        names.map(async (name) => [name, await fetchLatestVersion(projectDir, name)]),
      );
      latestByName = Object.fromEntries(looked.filter(([, version]) => version));

      // nothing resolved: offline, or the npm token expired. Stay quiet and
      // leave any previous cache alone so the next run can try again.
      if (Object.keys(latestByName).length === 0) return null;

      checkedOn = today;
      declined = false;
      writeState(projectDir, { checkedOn, latestByName, declined });
    }

    const latest = Object.values(latestByName).reduce((best, version) =>
      compareVersions(version, best) > 0 ? version : best,
    );

    const installed = names.map((name) => getInstalledVersion(projectDir, name));
    const known = installed.filter(Boolean);
    const current = known.length
      ? known.reduce((lowest, version) =>
          compareVersions(version, lowest) < 0 ? version : lowest,
        )
      : null;

    // every package moves to `latest` together, even one already there -- they
    // ship in lockstep and share transitive deps, so a partial bump mismatches.
    const packages = names.map((name, index) => ({
      name,
      current: installed[index],
      latest,
    }));

    return {
      checkedOn,
      current,
      latest,
      declined,
      packages,
      updateAvailable: Boolean(current) && compareVersions(latest, current) > 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// prompting
// ---------------------------------------------------------------------------

/**
 * Ask a yes/no question, defaulting to **no**.
 *
 * Returns `null` -- not `false` -- when there is no TTY to ask on, so the
 * caller can print a notice instead of silently treating a pipe as a refusal.
 * Without this guard a piped or scripted `pi-web start` would hang forever
 * waiting for input that can never arrive.
 */
export async function confirmPrompt(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } catch {
    return null;
  } finally {
    // without this the process never exits
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// the update
// ---------------------------------------------------------------------------

function runPnpm(projectDir, args) {
  const result = spawnSync(toCommandLine(args), {
    cwd: projectDir,
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  });
  return result.status ?? 1;
}

function acquireLock(projectDir) {
  const file = lockFile(projectDir);

  try {
    fs.mkdirSync(dataDir(projectDir), { recursive: true });

    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ pid: process.pid, at: Date.now() }),
        { flag: "wx" },
      );
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      const existing = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Date.now() - (existing.at ?? 0) < LOCK_STALE_MS) return false;

      // stale: the previous run died before releasing it
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }));
      return true;
    }
  } catch {
    // a broken lock must not make updating impossible
    return true;
  }
}

function releaseLock(projectDir) {
  try {
    fs.rmSync(lockFile(projectDir), { force: true });
  } catch {
    // best effort
  }
}

/**
 * Install the new packages and rebuild.
 *
 * **The caller must stop the server first.** This module knows nothing about
 * PM2 on purpose; `bin/pi-web.js` owns that. Windows holds locks on `build/`
 * and `node_modules` while the server runs, so installing underneath a live
 * server fails in confusing ways.
 *
 * Leaves the server stopped and the build fresh. The caller decides what to
 * start, which is what lets `pi-web reload` skip its own redundant build.
 *
 * Rollback is by rename, not by rebuild: `react-router build` empties `build/`
 * before it writes, so once it has failed there is no previous build left to
 * fall back to. Moving it aside first is the only way to actually get it back.
 */
export async function runUpdate({ projectDir, packages, to, onStep = () => {} }) {
  if (!acquireLock(projectDir)) {
    return {
      ok: false,
      error: "Another update is already running (see .data/update.lock).",
    };
  }

  const backup = backupDir(projectDir);
  const buildDir = path.join(projectDir, "build");
  const buildBackup = path.join(projectDir, "build.bak");

  let movedBuild = false;
  let backedUp = false;

  try {
    onStep("backup");
    fs.rmSync(backup, { recursive: true, force: true });
    fs.mkdirSync(backup, { recursive: true });
    for (const name of BACKED_UP_FILES) {
      const source = path.join(projectDir, name);
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(backup, name));
      }
    }
    backedUp = true;

    // `pnpm add`, not `pnpm update`: the ranges are `^0.85.1`, and for a 0.x
    // version caret means `>=0.85.1 <0.86.0`, so `update` would do nothing at
    // all. `add` rewrites the range in package.json.
    onStep("install");
    const specs = packages.map((entry) => `${entry.name}@${to}`);
    if (runPnpm(projectDir, ["add", ...specs]) !== 0) {
      throw new Error("pnpm add failed");
    }

    onStep("build");
    fs.rmSync(buildBackup, { recursive: true, force: true });
    if (fs.existsSync(buildDir)) {
      fs.renameSync(buildDir, buildBackup);
      movedBuild = true;
    }

    if (runPnpm(projectDir, ["build"]) !== 0) {
      throw new Error("pnpm build failed");
    }

    fs.rmSync(buildBackup, { recursive: true, force: true });
    movedBuild = false;

    // otherwise the stale cache keeps announcing an update that just landed
    clearState(projectDir);

    return { ok: true, to };
  } catch (error) {
    onStep("rollback");

    try {
      if (movedBuild) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        fs.renameSync(buildBackup, buildDir);
      }
      if (backedUp) {
        for (const name of BACKED_UP_FILES) {
          const source = path.join(backup, name);
          if (fs.existsSync(source)) {
            fs.copyFileSync(source, path.join(projectDir, name));
          }
        }
        runPnpm(projectDir, ["install"]);
      }
    } catch (rollbackError) {
      return {
        ok: false,
        error: `${error.message}. Rollback also failed: ${rollbackError.message}. Restore package.json and pnpm-lock.yaml from ${backup}, then run: pnpm install && pi-web reload`,
      };
    }

    return { ok: false, error: error.message };
  } finally {
    releaseLock(projectDir);
  }
}
