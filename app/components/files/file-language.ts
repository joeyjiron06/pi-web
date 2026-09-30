/**
 * Binary-file detection for the file preview.
 *
 * Language mapping lives in `monaco-language.ts` -- the viewer renders through
 * Monaco now, and Monaco's language ids are not shiki's.
 */

/**
 * Extensions we refuse to decode as text. `/fs/file` serves everything as
 * `application/octet-stream`, so nothing else stops us handing a JPEG to
 * `res.text()` and then to a syntax highlighter.
 */
const BINARY_EXTENSIONS = new Set([
  "7z", "avi", "bin", "bmp", "bz2", "class", "dll", "dmg", "doc", "docx",
  "dylib", "ear", "exe", "flac", "gif", "gz", "ico", "jar", "jpeg", "jpg",
  "mkv", "mov", "mp3", "mp4", "o", "odt", "ogg", "otf", "pdf", "png", "ppt",
  "pptx", "psd", "rar", "so", "sqlite", "tar", "tgz", "ttf", "wasm", "wav",
  "webm", "webp", "woff", "woff2", "xls", "xlsx", "zip",
]);

export function isBinaryFileName(fileName: string): boolean {
  const name = fileName.toLowerCase();
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return false;
  return BINARY_EXTENSIONS.has(name.slice(lastDot + 1));
}
