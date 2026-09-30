import os from "node:os";
import path from "node:path";
import type { FileOrFolder, FolderItem } from "~/routes/fs/fs.types";

/**
 * Expands a leading `~` to the user's home directory and returns an absolute,
 * normalized path.
 */
export function resolvePath(input: string): string {
  const home = os.homedir();
  let expanded = input.trim();

  if (expanded === "~") {
    expanded = home;
  } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = path.join(home, expanded.slice(2));
  }

  return path.resolve(expanded);
}

/**
 * Converts an absolute path into a display path, replacing the home directory
 * with `~`.
 */
export function toDisplayPath(absolutePath: string): string {
  const home = os.homedir();
  const relative = path.relative(home, absolutePath);

  // outside of the home dir (or on another drive) -> show the full path
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolutePath === home ? "~" : absolutePath;
  }

  return `~/${relative.split(path.sep).join("/")}`;
}

export function toFileOrFolder(
  absolutePath: string,
  kind: FileOrFolder["kind"],
): FileOrFolder {
  return {
    path: absolutePath,
    displayPath: toDisplayPath(absolutePath),
    name: path.basename(absolutePath),
    kind,
  };
}

export function toFolderItem(absolutePath: string, name?: string): FolderItem {
  const item = toFileOrFolder(absolutePath, "folder") as FolderItem;
  return name ? { ...item, name } : item;
}

export function homeDirectory(): FolderItem {
  const home = os.homedir();
  return toFileOrFolder(home, "folder") as FolderItem;
}
