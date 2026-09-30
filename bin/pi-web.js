#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { userInfo, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const PM2_APP_NAME = "pi-web";
const VITE_PORT = 5000;
const LOCAL_URL = `http://localhost:${VITE_PORT}`;

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

async function install() {
  ensurePm2Installed();
  console.log("Building pi-web...");
  run("pnpm", ["build"], { check: true, cwd: PROJECT_DIR });
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
async function reload() {
  await stopProcess();

  console.log("Building pi-web...");
  const buildStatus = run("pnpm", ["build"], { cwd: PROJECT_DIR });
  if (buildStatus !== 0) {
    console.error("\nBuild failed — restarting the previous build instead.");
    await startProcess();
    process.exit(buildStatus);
  }

  await startProcess();
  console.log(`Reloaded pi-web.`);
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

  if (!up) process.exitCode = 1;
}

function logs() {
  run("pm2", ["logs", PM2_APP_NAME, "--lines", "200"]);
}

function doctor() {
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
  pi-web status        Show server status
  pi-web logs          Tail server logs (via PM2)
  pi-web doctor        Run diagnostic checks
  pi-web version       Show version
  pi-web help          Show this help

Ports:
  Local: ${LOCAL_URL}
`);
}

async function main() {
  const [command = "help"] = process.argv.slice(2);

  switch (command) {
    case "install":
      await install();
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
      await reload();
      break;
    case "status":
      await status();
      break;
    case "logs":
      logs();
      break;
    case "doctor":
      doctor();
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
