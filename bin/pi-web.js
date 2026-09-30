#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { userInfo, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkForUpdate,
  confirmPrompt,
  markDeclined,
  runUpdate,
} from "./lib/updates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const PM2_APP_NAME = "pi-web";
const VITE_PORT = 5000;
const LOCAL_URL = `http://localhost:${VITE_PORT}`;

/**
 * Commands that consult the registry (once per calendar day) and may prompt.
 *
 * Deliberately not every command. `stop` and `uninstall` are the wrong moment
 * to offer an update, `logs` blocks on a tail, and `version`/`help` must stay
 * instant. `status` and `doctor` report from cache without a network call.
 */
const UPDATE_PROMPT_COMMANDS = new Set(["install", "start", "restart", "reload"]);

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: "bash",
    ...opts,
  });
  const status = result.status ?? 1;
  if (opts.check && status !== 0) {
    console.log(result.error);
    // console.error(result.stderr?.toString());
    process.exit(status);
  }
  return status;
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: "bash",
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error,
  };
}

function packageVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(PROJECT_DIR, "package.json"), "utf8"),
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "unknown";
  }
}

function getPm2Process() {
  const r = capture("pm2", ["jlist"]);
  if (r.status !== 0) return null;
  try {
    const list = JSON.parse(r.stdout);
    return list.find((p) => p.name === PM2_APP_NAME) ?? null;
  } catch {
    return null;
  }
}

async function ping(timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(LOCAL_URL, { signal: ctrl.signal });
    clearTimeout(t);
    return res.status === 200;
  } catch {
    return false;
  }
}

function ensurePm2Installed() {
  const pm2Check = capture("pm2", ["--version"]);
  if (pm2Check.status === 0) return;

  console.log(
    "PM2 not found — installing globally (pnpm install -g pm2 pm2-windows-startup)...",
  );
  run("pnpm", ["install", "-g", "pm2", "pm2-windows-startup"], {
    check: true,
    stdio: "pipe",
  });
  console.log("PM2 installed.\n");
}

// ---------- install / uninstall ----------

async function install({ skipBuild = false } = {}) {
  ensurePm2Installed();
  if (!skipBuild) {
    console.log("Building pi-web...");
    run("pnpm", ["build"], { check: true, cwd: PROJECT_DIR });
  }
  await startProcess();

  // Persist the process list so PM2 restores pi-web after the daemon restarts.
  run("pm2", ["save"], { check: true });

  // Register the PM2 daemon itself to launch on Windows logon.
  run("pm2-startup", ["install"]);

  console.log(`\npi-web installed and started.`);
  console.log(`  Project: ${PROJECT_DIR}`);
  console.log(
    `  PM2:     ${PM2_APP_NAME} (auto-restarts on crash, starts on logon)`,
  );
  console.log(`  Local:   ${LOCAL_URL}`);
}

async function uninstall() {
  await stopProcess();
  // Save the updated (empty) process list so PM2 doesn't try to restore pi-web on next logon.
  run("pm2", ["save"]);
  console.log("pi-web uninstalled.");
}

// ---------- process management ----------

async function startProcess() {
  const proc = getPm2Process();

  if (proc) {
    if (proc.pm2_env?.status === "online" && (await ping())) {
      console.log(`pi-web is already running at ${LOCAL_URL}`);
      return;
    }
    // Known to PM2 but not healthy — restart in-place.
    run("pm2", ["restart", PM2_APP_NAME], { check: true });
  } else {
    // First start — use the dev-server.js wrapper so PM2 runs a plain Node script
    // (no .cmd interpreter issues) and cwd is resolved inside the script itself
    // (no Windows path conversion issues from passing --cwd on the CLI).
    run("pm2", ["start", "dev-server.js", "--name", PM2_APP_NAME], {
      check: true,
      cwd: __dirname,
    });
  }

  process.stdout.write(`Starting pi-web`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await ping()) {
      process.stdout.write("\n");
      console.log(`pi-web is up at ${LOCAL_URL}`);
      console.log(`Logs: pm2 logs ${PM2_APP_NAME}`);
      return;
    }
    const current = getPm2Process();
    if (current?.pm2_env?.status === "errored") {
      process.stdout.write("\n");
      console.error("pi-web process errored before becoming ready.");
      console.error(`See logs: pm2 logs ${PM2_APP_NAME}`);
      process.exit(1);
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("\n");
  console.error(`Timed out waiting for ${LOCAL_URL} to respond.`);
  console.error(`See logs: pm2 logs ${PM2_APP_NAME}`);
  process.exit(1);
}

async function stopProcess() {
  const proc = getPm2Process();
  if (!proc) {
    console.log("pi-web is not running.");
    return;
  }
  run("pm2", ["delete", PM2_APP_NAME], { check: true });
  console.log(`Stopped pi-web.`);
}

// Stop -> build -> start. The server serves ./build output and Windows locks
// those files while running, so the process must be stopped before rebuilding.
//
// `skipBuild` is set when an update already rebuilt, so this doesn't spend
// another minute producing the same output.
async function reload({ skipBuild = false } = {}) {
  await stopProcess();

  if (!skipBuild) {
    console.log("Building pi-web...");
    const buildStatus = run("pnpm", ["build"], { cwd: PROJECT_DIR });
    if (buildStatus !== 0) {
      console.error("\nBuild failed — restarting the previous build instead.");
      await startProcess();
      process.exit(buildStatus);
    }
  }

  await startProcess();
  console.log(`Reloaded pi-web.`);
}

// ---------- updates ----------

/**
 * Stop the server, install the new Pi packages, rebuild.
 *
 * Safe to run from here and *not* from inside the served app: this process is
 * your terminal, so `pm2 delete pi-web` cannot kill it halfway through.
 *
 * Leaves the server stopped on success so the caller can decide what to start.
 * On failure the rollback has already restored the previous build, so the
 * server is brought straight back up.
 *
 * @returns `true` when the build is fresh and the caller should skip its own.
 */
async function performUpdate(check) {
  console.log(`\nUpdating Pi SDK ${check.current} -> ${check.latest}...\n`);

  await stopProcess();

  const steps = {
    backup: "Backing up package.json and pnpm-lock.yaml...",
    install: "Installing new packages...",
    build: "Building pi-web...",
    rollback: "Update failed — rolling back...",
  };

  const result = await runUpdate({
    projectDir: PROJECT_DIR,
    packages: check.packages,
    to: check.latest,
    onStep: (step) => console.log(`\n${steps[step] ?? step}`),
  });

  if (!result.ok) {
    console.error(`\n✗ ${result.error}`);
    await startProcess();
    return false;
  }

  console.log(`\n✓ Pi SDK updated to ${check.latest}.`);
  console.log(
    `  package.json and pnpm-lock.yaml changed — commit them when you're happy.`,
  );
  console.log(
    `  To revert: git checkout package.json pnpm-lock.yaml && pnpm install && pi-web reload`,
  );
  return true;
}

/**
 * The daily check that runs before a gated command.
 *
 * @returns `true` when an update was installed and the build is already fresh.
 */
async function maybePromptForUpdate(command) {
  if (!UPDATE_PROMPT_COMMANDS.has(command)) return false;

  const check = await checkForUpdate({ projectDir: PROJECT_DIR });
  if (!check?.updateAvailable || check.declined) return false;

  console.log(`\nPi SDK update available: ${check.current} -> ${check.latest}`);

  const answer = await confirmPrompt("Update now?");

  if (answer === null) {
    // no TTY to ask on -- a prompt here would hang forever
    console.log(`Run \`pi-web update\` to install it.\n`);
    return false;
  }

  if (!answer) {
    markDeclined(PROJECT_DIR);
    console.log(`Skipped. You won't be asked again today.\n`);
    return false;
  }

  return await performUpdate(check);
}

/** `pi-web update [--check] [--yes]` */
async function updateCommand(args) {
  const checkOnly = args.includes("--check");
  const assumeYes = args.includes("--yes") || args.includes("-y");

  console.log("Checking for Pi SDK updates...");
  const check = await checkForUpdate({ projectDir: PROJECT_DIR, force: true });

  if (!check) {
    console.error(
      "Could not check for updates. Check your network and the npm token in ~/.npmrc.",
    );
    process.exitCode = 1;
    return;
  }

  if (!check.updateAvailable) {
    console.log(`✓ Pi SDK is up to date (${check.current}).`);
    return;
  }

  console.log(`Pi SDK update available: ${check.current} -> ${check.latest}`);
  for (const entry of check.packages) {
    console.log(`  ${entry.name}  ${entry.current ?? "(missing)"} -> ${entry.latest}`);
  }

  // `--check` deliberately leaves `declined` alone, so asking "is there an
  // update?" does not silence today's prompt.
  if (checkOnly) {
    console.log(`\nRun \`pi-web update\` to install it.`);
    return;
  }

  if (!assumeYes) {
    const answer = await confirmPrompt("Update now?");
    if (answer === null) {
      console.error(
        "No terminal to prompt on. Re-run with --yes to update without asking.",
      );
      process.exitCode = 1;
      return;
    }
    if (!answer) {
      markDeclined(PROJECT_DIR);
      console.log("Skipped. You won't be asked again today.");
      return;
    }
  }

  const updated = await performUpdate(check);
  if (!updated) {
    process.exitCode = 1;
    return;
  }

  await startProcess();
}

/** A one-line note for `status` and `doctor`. Reads the cache, never the network. */
async function printCachedUpdateNotice(indent = "  ") {
  const check = await checkForUpdate({
    projectDir: PROJECT_DIR,
    cachedOnly: true,
  });
  if (check?.updateAvailable) {
    console.log(
      `${indent}Update:  Pi SDK ${check.current} -> ${check.latest} (run: pi-web update)`,
    );
  }
}

async function serviceAction(action) {
  if (action === "start") {
    await startProcess();
  } else if (action === "stop") {
    await stopProcess();
  } else if (action === "restart") {
    const proc = getPm2Process();
    if (proc) {
      run("pm2", ["restart", PM2_APP_NAME], { check: true });
      console.log(`Restarted pi-web.`);
    } else {
      await startProcess();
    }
  }
}

// ---------- status / logs / doctor ----------

async function status() {
  const proc = getPm2Process();
  const online = proc?.pm2_env?.status === "online";
  const up = online && (await ping());

  if (up) {
    const pid = proc.pid;
    const restarts = proc.pm2_env?.restart_time ?? 0;
    console.log(`✓ pi-web: active (pid ${pid}, restarts: ${restarts})`);
  } else if (proc) {
    console.log(`✗ pi-web: ${proc.pm2_env?.status ?? "unknown"}`);
  } else {
    console.log(`✗ pi-web: not running`);
  }
  console.log(`  Project: ${PROJECT_DIR}`);
  if (up) console.log(`  Local:   ${LOCAL_URL}`);
  await printCachedUpdateNotice();

  if (!up) process.exitCode = 1;
}

function logs() {
  run("pm2", ["logs", PM2_APP_NAME, "--lines", "200"]);
}

async function doctor() {
  console.log(`Platform: Windows (${release()})`);
  console.log(`Service backend: PM2`);
  console.log(`Project: ${PROJECT_DIR}`);
  console.log("");

  let ok = true;

  const nodeResult = capture("node", ["--version"]);
  if (nodeResult.status === 0) {
    const major = parseInt(nodeResult.stdout.replace("v", ""));
    if (major >= 22) {
      console.log(`✓ node ${nodeResult.stdout}`);
    } else {
      console.log(`✗ node ${nodeResult.stdout} (need >= 22)`);
      ok = false;
    }
  } else {
    console.log("✗ node not found");
    ok = false;
  }

  const npmResult = capture("npm.cmd", ["--version"]);
  if (npmResult.status === 0) {
    console.log(`✓ npm ${npmResult.stdout}`);
  } else {
    console.log("✗ npm not found");
    ok = false;
  }

  const pm2Result = capture("pm2", ["--version"]);
  if (pm2Result.status === 0) {
    console.log(`✓ pm2 ${pm2Result.stdout}`);
  } else {
    console.log("✗ pm2 not found — run `pi-web install` to set up");
    ok = false;
  }

  // pm2-startup is the CLI binary from the pm2-windows-startup package.
  // It will exit with usage text (non-zero) when called with no args, but
  // result.error being set (ENOENT) means the binary itself wasn't found.
  const pm2StartupResult = capture("pm2-startup", []);
  if (!pm2StartupResult.error) {
    console.log(`✓ pm2-windows-startup installed`);
  } else {
    console.log(
      "✗ pm2-windows-startup not found — run `pi-web install` to set up",
    );
    ok = false;
  }

  if (existsSync(join(PROJECT_DIR, "package.json"))) {
    console.log(`✓ project directory exists`);
  } else {
    console.log(`✗ project directory missing: ${PROJECT_DIR}`);
    ok = false;
  }

  if (existsSync(join(PROJECT_DIR, "node_modules"))) {
    console.log(`✓ node_modules installed`);
  } else {
    console.log(`✗ node_modules missing — run pnpm install in ${PROJECT_DIR}`);
    ok = false;
  }

  const proc = getPm2Process();
  if (proc) {
    console.log(`✓ PM2 process registered (status: ${proc.pm2_env?.status})`);
  } else {
    console.log(`! PM2 process not registered — run \`pi-web install\``);
  }

  console.log(`  User: ${userInfo().username}`);
  await printCachedUpdateNotice();

  if (!ok) process.exitCode = 1;
}

// ---------- help / main ----------

function help() {
  console.log(`pi-web — manage the pi-web dev server (Windows, via PM2)

Usage:
  pi-web install       Install PM2 if needed, start server, register logon autostart
  pi-web uninstall     Stop the server and remove it from PM2
  pi-web start         Start the server
  pi-web stop          Stop the server
  pi-web restart       Restart the server
  pi-web reload        Stop the server, rebuild, then start it again
  pi-web update        Update the Pi SDK packages, rebuild, restart
  pi-web status        Show server status
  pi-web logs          Tail server logs (via PM2)
  pi-web doctor        Run diagnostic checks
  pi-web version       Show version
  pi-web help          Show this help

Update options:
  --check              Report what is available; don't install anything
  --yes, -y            Skip the confirmation prompt

Updates:
  install, start, restart and reload check for a new Pi SDK once a day and
  offer to install it. Answer "no" and you won't be asked again until the
  next day. Run \`pi-web update\` any time to check on demand.

Ports:
  Local: ${LOCAL_URL}
`);
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  // Runs before the command so you are never surprised mid-way. When it
  // returns true the build is already fresh, so the command skips its own.
  const didUpdate = await maybePromptForUpdate(command);

  switch (command) {
    case "install":
      await install({ skipBuild: didUpdate });
      break;
    case "uninstall":
      await uninstall();
      break;
    case "start":
    case "stop":
    case "restart":
      await serviceAction(command);
      break;
    case "reload":
      await reload({ skipBuild: didUpdate });
      break;
    case "update":
      await updateCommand(args);
      break;
    case "status":
      await status();
      break;
    case "logs":
      logs();
      break;
    case "doctor":
      await doctor();
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(packageVersion());
      break;
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      help();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
