#!/usr/bin/env node
/**
 * PM2 entry point for the pi-web dev server.
 *
 * PM2 runs this file with Node directly (no .cmd issues).
 * This script spawns pnpm.cmd as a child process so stdout/stderr
 * flow through to PM2's log capture.
 *
 * cwd is derived from __dirname so no Windows path conversion issues
 * arise from passing --cwd on the command line.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn("cmd.exe", ["/c", "pnpm.cmd start -- --host"], {
  windowsHide: true,
  cwd: PROJECT_DIR,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => process.exit(code ?? 0));
