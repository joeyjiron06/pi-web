#!/usr/bin/env node
/**
 * Copies monaco's prebuilt AMD bundle into `public/monaco/vs`.
 *
 * The editor is loaded from our own origin rather than the jsDelivr CDN that
 * `@monaco-editor/react` defaults to: this app is meant to run on a LAN with
 * no guarantee of internet access, so a CDN fetch would leave the file viewer
 * spinning forever.
 *
 * The copy is generated, not committed (see .gitignore). It runs on
 * `postinstall` and again on `prebuild` so both `pnpm dev` and Docker builds
 * always have it, and so it can never drift from the installed version.
 */
import { createRequire } from "node:module";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

// monaco's `exports` map rewrites every subpath into `esm/`, so `min/vs` can't
// be resolved directly -- resolve the entry point and walk back to the package
// root instead
const entry = require.resolve("monaco-editor");
const packageRoot = entry.slice(
  0,
  entry.lastIndexOf(`${path.sep}monaco-editor${path.sep}`) +
    `${path.sep}monaco-editor`.length,
);
const monacoPackageJson = path.join(packageRoot, "package.json");
const source = path.join(packageRoot, "min", "vs");

const root = path.resolve(import.meta.dirname, "..");
const destination = path.join(root, "public", "monaco", "vs");
const stamp = path.join(root, "public", "monaco", ".version");

const { version } = JSON.parse(await readFile(monacoPackageJson, "utf8"));

// skip the copy when the existing one already matches the installed version;
// this script runs on every build and the tree is a few thousand files
const current = await readFile(stamp, "utf8").catch(() => null);
if (current === version) {
  console.log(`monaco ${version} already synced to public/monaco/vs`);
  process.exit(0);
}

await rm(path.join(root, "public", "monaco"), {
  recursive: true,
  force: true,
});
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
await writeFile(stamp, version);

console.log(`copied monaco ${version} -> public/monaco/vs`);
