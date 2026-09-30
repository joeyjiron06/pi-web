import { createReadStream, type Stats } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { resolvePath } from "~/services/fs.server";
import type { Route } from "./+types/file";

/** A streamed response can't be meaningfully revalidated after an action. */
export function shouldRevalidate() {
  return false;
}

/**
 * GET /fs/file?path=<path>
 *
 * Streams the raw bytes of a file straight from disk to the client; the server
 * never holds more than one chunk in memory.
 *
 *  - 400 if `path` is missing or isn't a regular file
 *  - 403 if the process can't read it
 *  - 404 if it doesn't exist
 *  - 304 when `If-None-Match` / `If-Modified-Since` still match
 *
 * Errors are *thrown* as Responses (not returned as JSON like the sibling
 * `/fs/*` routes) because a streaming endpoint is consumed by `fetch`, not by
 * `useFetcher().load()`.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path");

  if (!rawPath?.trim()) {
    throw new Response("Missing required query param: path", { status: 400 });
  }

  const absolutePath = resolvePath(rawPath);

  let stats: Stats;
  try {
    // stat (not lstat) so symlinked files resolve to their target
    stats = await fs.stat(absolutePath);
  } catch (error) {
    throw toHttpError(error, absolutePath);
  }

  if (stats.isDirectory()) {
    throw new Response(`Not a file: ${absolutePath}`, { status: 400 });
  }
  // fifos/sockets/devices have no meaningful size and can block forever on read
  if (!stats.isFile()) {
    throw new Response(`Not a regular file: ${absolutePath}`, { status: 400 });
  }

  const etag = `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;

  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "Last-Modified": new Date(stats.mtimeMs).toUTCString(),
  });

  // a 304 carries validators only -- a Content-Length here would describe a
  // body that isn't being sent
  if (isFresh(request, etag, stats.mtimeMs)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(stats.size));

  // HEAD must carry identical headers but no body; an empty file has no bytes
  // to stream, and opening a read stream for zero bytes is pure overhead
  if (request.method === "HEAD" || stats.size === 0) {
    return new Response(null, { status: 200, headers });
  }

  return new Response(toWebStream(absolutePath, request.signal), {
    status: 200,
    headers,
  });
}

/**
 * Bridges a Node read stream onto a web ReadableStream.
 *
 * `Readable.toWeb` alone would leak the file descriptor when the client goes
 * away: nothing links `request.signal` to the fd, and the stream only learns
 * about the disconnect once it tries (and fails) to write. So the abort is
 * wired up explicitly and the fd destroyed on cancel.
 */
function toWebStream(
  absolutePath: string,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  // 64KiB: large enough that syscall overhead is negligible, small enough that
  // N concurrent reads don't add up to real memory
  const nodeStream = createReadStream(absolutePath, {
    highWaterMark: 64 * 1024,
  });

  const onAbort = () => nodeStream.destroy();
  signal.addEventListener("abort", onAbort, { once: true });
  nodeStream.once("close", () => signal.removeEventListener("abort", onAbort));

  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

/** True when the client's cached copy is still valid. */
function isFresh(request: Request, etag: string, mtimeMs: number): boolean {
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch) {
    return ifNoneMatch.split(",").some((candidate) => candidate.trim() === etag);
  }

  const ifModifiedSince = request.headers.get("If-Modified-Since");
  if (!ifModifiedSince) return false;

  const since = Date.parse(ifModifiedSince);
  // header precision is whole seconds, so floor before comparing
  return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
}

function toHttpError(error: unknown, absolutePath: string): Response {
  const code = (error as NodeJS.ErrnoException)?.code;

  if (code === "ENOENT" || code === "ENOTDIR") {
    return new Response(`Path not found: ${absolutePath}`, { status: 404 });
  }
  if (code === "EACCES" || code === "EPERM") {
    return new Response(`Permission denied: ${absolutePath}`, { status: 403 });
  }
  if (code === "EISDIR") {
    return new Response(`Not a file: ${absolutePath}`, { status: 400 });
  }

  throw error;
}
