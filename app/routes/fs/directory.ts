import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { data } from "react-router";
import { resolvePath, toFileOrFolder } from "~/services/fs.server";
import type { Route } from "./+types/directory";
import type { FileItem, FolderItem } from "./fs.types";

export type DirectoryResponse = {
  // the resolved absolute path that was listed
  path: string;

  // the listed directory itself, so callers can select it without re-deriving
  // name/displayPath on the client (which doesn't know the home dir)
  folder: FolderItem;

  folders: FolderItem[];

  // always present so the response has a single shape; empty unless `include`
  // asked for files
  files: FileItem[];
};

export type DirectoryErrorResponse = {
  message: string;
};

export type DirectoryResult = DirectoryResponse | DirectoryErrorResponse;

export function isDirectoryError(
  result: DirectoryResult | undefined,
): result is DirectoryErrorResponse {
  return !!result && "message" in result;
}

/** What the caller wants listed. */
type IncludeKind = "files" | "folders";

/**
 * Parses the `include` query param: a comma-separated list of `files` and
 * `folders`.
 *
 * Defaults to folders-only, which is what the folder picker has always got --
 * adding files by default would silently change that caller.
 *
 * An unrecognised or empty value falls back to the default rather than
 * erroring, so a typo can't break browsing.
 */
function parseInclude(raw: string | null): Set<IncludeKind> {
  const requested = new Set<IncludeKind>();

  for (const part of raw?.split(",") ?? []) {
    const value = part.trim().toLowerCase();
    if (value === "files" || value === "folders") {
      requested.add(value);
    }
  }

  return requested.size > 0 ? requested : new Set<IncludeKind>(["folders"]);
}

/**
 * Fetcher loads of this route are *not* revalidated after unrelated actions.
 *
 * The file explorer mounts one fetcher per expanded folder, and React Router
 * revalidates every mounted fetcher after any action -- so a single git stage
 * or commit would re-`readdir` every open folder at once. The explorer instead
 * refreshes explicitly via its own refresh control.
 */
export function shouldRevalidate() {
  return false;
}

/**
 * GET /fs/directory?path=<path_name>&include=<files,folders>
 *
 * Returns the entries directly inside the given path. `include` defaults to
 * `folders`.
 *  - 400 if `path` is missing/empty or points at a file
 *  - 403 if the process can't read the directory
 *  - 404 if the path doesn't exist
 *
 * Errors are *returned* (with the status code set) rather than thrown, so that
 * `useFetcher().load(...)` callers get them in `fetcher.data` and can render an
 * inline message instead of tripping the nearest route ErrorBoundary.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path");
  const include = parseInclude(url.searchParams.get("include"));

  if (!rawPath?.trim()) {
    return data<DirectoryResult>(
      { message: "Missing required query param: path" },
      400,
    );
  }

  const absolutePath = resolvePath(rawPath);

  let stats: Stats;
  try {
    // stat (not lstat) so symlinked directories are treated as directories
    stats = await fs.stat(absolutePath);
  } catch (error) {
    return toHttpError(error, absolutePath);
  }

  if (!stats.isDirectory()) {
    return data<DirectoryResult>(
      { message: `Not a directory: ${absolutePath}` },
      400,
    );
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(absolutePath, { withFileTypes: true });
  } catch (error) {
    return toHttpError(error, absolutePath);
  }

  const folders: FolderItem[] = [];
  const files: FileItem[] = [];

  for (const entry of entries) {
    const entryPath = path.join(absolutePath, entry.name);
    let isDirectory = entry.isDirectory();

    // symlinks need to be resolved to know what they point at
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = (await fs.stat(entryPath)).isDirectory();
      } catch {
        // broken symlink or no permission -> skip it
        continue;
      }
    }

    if (isDirectory) {
      if (include.has("folders")) {
        folders.push(toFileOrFolder(entryPath, "folder") as FolderItem);
      }
      continue;
    }

    // sockets, fifos and device files aren't useful to list or open
    if (include.has("files") && (entry.isFile() || entry.isSymbolicLink())) {
      files.push(toFileOrFolder(entryPath, "file") as FileItem);
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return data<DirectoryResult>({
    path: absolutePath,
    folder: toFileOrFolder(absolutePath, "folder") as FolderItem,
    folders,
    files,
  });
}

function toHttpError(error: unknown, absolutePath: string) {
  const code = (error as NodeJS.ErrnoException)?.code;

  if (code === "ENOENT") {
    return data<DirectoryResult>(
      { message: `Path not found: ${absolutePath}` },
      404,
    );
  }
  // a path segment that's actually a file, e.g. /some/file.txt/child
  if (code === "ENOTDIR") {
    return data<DirectoryResult>(
      { message: `Not a directory: ${absolutePath}` },
      400,
    );
  }
  if (code === "EACCES" || code === "EPERM") {
    return data<DirectoryResult>(
      { message: `Permission denied: ${absolutePath}` },
      403,
    );
  }

  throw error;
}
