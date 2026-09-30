/**
 * Extension -> monaco language id.
 *
 * Separate from `file-language.ts` (which maps to *shiki* ids for the chat
 * transcript's code blocks): the two vocabularies overlap but disagree --
 * shiki says `shellscript`/`docker`/`text`, monaco says `shell`/`dockerfile`/
 * `plaintext` -- and an id monaco doesn't know silently falls back to no
 * highlighting at all.
 *
 * Deliberately hand-written rather than derived from monaco's registry: an
 * unknown extension must land on `plaintext`, not on a guess.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "shell",
  bat: "bat",
  c: "c",
  cjs: "javascript",
  clj: "clojure",
  cmd: "bat",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  diff: "plaintext",
  dockerfile: "dockerfile",
  ex: "elixir",
  exs: "elixir",
  fs: "fsharp",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  // monaco's json mode understands comments; there is no separate `jsonc`
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  less: "less",
  lua: "lua",
  m: "objective-c",
  md: "markdown",
  // no mdx grammar; markdown is the closest thing that isn't plain text
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  patch: "plaintext",
  php: "php",
  pl: "perl",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sh: "shell",
  sql: "sql",
  // svelte/vue have no monaco grammar; html at least colours the markup
  svelte: "html",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  vue: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

/** Files whose whole name (not extension) identifies the language. */
const LANGUAGE_BY_FILENAME: Record<string, string> = {
  ".bashrc": "shell",
  ".zshrc": "shell",
  dockerfile: "dockerfile",
  makefile: "plaintext",
};

export const PLAIN_TEXT = "plaintext";

export function toMonacoLanguage(fileName: string): string {
  const name = fileName.toLowerCase();

  const byName = LANGUAGE_BY_FILENAME[name];
  if (byName) return byName;

  // `.gitignore` has no extension in the usual sense -- the leading dot is the
  // whole name, so slicing on the last dot would yield the filename itself
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return PLAIN_TEXT;

  return LANGUAGE_BY_EXTENSION[name.slice(lastDot + 1)] ?? PLAIN_TEXT;
}
