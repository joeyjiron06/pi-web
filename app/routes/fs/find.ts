import { Fzf } from "fzf";
import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { data } from "react-router";
import cache from "~/services/cache.server";
import { resolvePath, toDisplayPath } from "~/services/fs.server";
import { createGitCli } from "~/services/git.server";
import type { Route } from "./+types/find";
import type { FindMatch, FileOrFolder } from "./fs.types";

export type FindResponse = {
  // the resolved absolute path that was searched
  path: string;

  // best matches first, capped at `limit`
  matches: FindMatch[];
};

export type FindErrorResponse = {
  message: string;
};

export type FindResult = FindResponse | FindErrorResponse;

export function isFindError(
  result: FindResult | undefined,
): result is FindErrorResponse {
  return !!result && "message" in result;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

/**
 * The file tree is cached so that typing doesn't re-walk the disk on every
 * keystroke. The cost is staleness: a file created in the last 10 minutes
 * won't show up until the entry expires.
 */
const TREE_CACHE_TTL_MS = 10 * 60 * 1000;

/** Bumped whenever the cached shape changes, so old entries can't be read back. */
const TREE_CACHE_VERSION = "v1";

/**
 * GET /fs/find?path=<dir>&query=<text>&limit=<n>
 *
 * Fuzzy-searches every file and folder below `path` and returns the best
 * matches. `.gitignore` is respected when `path` is inside a git repo.
 *
 * An empty `query` is *not* an error: it returns the entries sitting directly
 * in `path` (folders first), so an `@` with nothing typed yet shows the root of
 * the project instead of an empty dropdown.
 *  - 400 if `path` is missing/empty or points at a file
 *  - 403 if the process can't read the directory
 *  - 404 if the path doesn't exist
 *
 * Like `/fs/directory`, errors are *returned* with a status code rather than
 * thrown, so `useFetcher().load(...)` callers get them in `fetcher.data` and
 * can render an inline message instead of tripping an ErrorBoundary.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path");
  const query = url.searchParams.get("query")?.trim() ?? "";
  const limit = parseLimit(url.searchParams.get("limit"));

  if (!rawPath?.trim()) {
    return data<FindResult>(
      { message: "Missing required query param: path" },
      400,
    );
  }

  const absolutePath = resolvePath(rawPath);

  let stats: Stats;
  try {
    // stat (not lstat) so a symlinked directory is treated as a directory
    stats = await fs.stat(absolutePath);
  } catch (error) {
    return toHttpError(error, absolutePath);
  }

  if (!stats.isDirectory()) {
    return data<FindResult>({ message: `Not a directory: ${absolutePath}` }, 400);
  }

  // an empty box shouldn't dump the entire tree over the wire -- just the top
  // level. read straight from disk rather than filtering the cached tree: the
  // git-backed tree only knows about folders that contain tracked files, so a
  // freshly created (or wholly untracked) top-level folder would be missing.
  if (!query) {
    return data<FindResult>({
      path: absolutePath,
      matches: await listRootEntries(absolutePath, limit),
    });
  }

  const entries = await getAllEntries(absolutePath);

  const fzf = new Fzf<FindMatch[]>(entries, {
    selector: (entry: FindMatch) => entry.relativePath,
    limit,
    casing: "case-insensitive",
  });

  return data<FindResult>({
    path: absolutePath,
    matches: fzf.find(query).map((result) => result.item),
  });
}

function parseLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function toHttpError(error: unknown, absolutePath: string) {
  const code = (error as NodeJS.ErrnoException)?.code;

  if (code === "ENOENT") {
    return data<FindResult>({ message: `Path not found: ${absolutePath}` }, 404);
  }
  // a path segment that's actually a file, e.g. /some/file.txt/child
  if (code === "ENOTDIR") {
    return data<FindResult>({ message: `Not a directory: ${absolutePath}` }, 400);
  }
  if (code === "EACCES" || code === "EPERM") {
    return data<FindResult>(
      { message: `Permission denied: ${absolutePath}` },
      403,
    );
  }

  throw error;
}

// ---------------------------------------------------------------------------
// Collecting candidates
// ---------------------------------------------------------------------------

/** Directories that are never worth searching, used by the non-git fallback. */
const SEARCH_EXCLUSIONS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
]);

/**
 * Guards against pathological trees. Nothing a file picker needs sits 12
 * levels down, and a cap means a symlink cycle can't spin forever.
 */
const MAX_DEPTH = 12;

/**
 * The entries sitting directly inside `rootPath`, folders first and then
 * alphabetical, capped at `limit`.
 *
 * Not cached: it's a single `readdir`, and staleness here is far more visible
 * than in the deep tree -- this is the list shown the instant `@` is typed.
 */
async function listRootEntries(
  rootPath: string,
  limit: number,
): Promise<FindMatch[]> {
  const dirEntries = await fs
    .readdir(rootPath, { withFileTypes: true })
    .catch(() => [] as Dirent[]);

  return dirEntries
    .filter((dirEntry) => !SEARCH_EXCLUSIONS.has(dirEntry.name))
    .map((dirEntry) =>
      toFindMatch(
        rootPath,
        dirEntry.name,
        dirEntry.isDirectory() ? "folder" : "file",
      ),
    )
    .sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name)
        : a.kind === "folder"
          ? -1
          : 1,
    )
    .slice(0, limit);
}

/**
 * Every file and folder below `rootPath`.
 *
 * Prefers `git ls-files` when `rootPath` is inside a work tree, so we inherit
 * `.gitignore` filtering for free, and falls back to a bounded recursive
 * readdir otherwise.
 */
async function getAllEntries(rootPath: string): Promise<FindMatch[]> {
  return cache.wrap(
    `fs-find:${TREE_CACHE_VERSION}:${rootPath}`,
    async () => {
      const git = createGitCli(rootPath);

      if (await git.isGitRepo()) {
        const relativeFilePaths = await git.listFiles();
        if (relativeFilePaths) {
          return fromGitFileList(rootPath, relativeFilePaths);
        }
      }

      return walkDirectory(rootPath, rootPath, 0);
    },
    { ttl: TREE_CACHE_TTL_MS },
  );
}

/**
 * `git ls-files` only reports files, so the folders that contain them have to
 * be derived from the path segments.
 */
function fromGitFileList(
  rootPath: string,
  relativeFilePaths: string[],
): FindMatch[] {
  const folderPaths = new Set<string>();

  for (const relativePath of relativeFilePaths) {
    // git always emits '/' separators, on every platform
    const parts = relativePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      folderPaths.add(parts.slice(0, i).join("/"));
    }
  }

  return [
    ...[...folderPaths].map((p) => toFindMatch(rootPath, p, "folder")),
    ...relativeFilePaths.map((p) => toFindMatch(rootPath, p, "file")),
  ];
}

async function walkDirectory(
  dirPath: string,
  rootPath: string,
  depth: number,
): Promise<FindMatch[]> {
  if (depth > MAX_DEPTH) return [];

  // unreadable directories (permissions, races) shouldn't fail the whole search
  const dirEntries = await fs
    .readdir(dirPath, { withFileTypes: true })
    .catch(() => [] as Dirent[]);

  const matches: FindMatch[] = [];

  for (const dirEntry of dirEntries) {
    if (SEARCH_EXCLUSIONS.has(dirEntry.name)) continue;

    const fullPath = path.join(dirPath, dirEntry.name);
    const isDirectory = dirEntry.isDirectory();

    matches.push(
      toFindMatch(
        rootPath,
        toRelativePath(rootPath, fullPath),
        isDirectory ? "folder" : "file",
      ),
    );

    // symlinked directories are listed but not descended into -- following them
    // duplicates entries and can loop back on itself
    if (isDirectory && !dirEntry.isSymbolicLink()) {
      matches.push(...(await walkDirectory(fullPath, rootPath, depth + 1)));
    }
  }

  return matches;
}

function toFindMatch(
  rootPath: string,
  relativePath: string,
  kind: FileOrFolder["kind"],
): FindMatch {
  const absolutePath = path.resolve(rootPath, relativePath);

  return {
    path: absolutePath,
    displayPath: toDisplayPath(absolutePath),
    name: relativePath.split("/").pop() ?? relativePath,
    kind,
    relativePath,
  };
}

/** Always '/'-separated, so a query behaves the same on Windows and POSIX. */
function toRelativePath(rootPath: string, fullPath: string): string {
  return path.relative(rootPath, fullPath).split(path.sep).join("/");
}
