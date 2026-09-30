import { useEffect, useState } from "react";
import { isBinaryFileName } from "./file-language";

/**
 * Anything larger than this is refused before the body is read. Syntax
 * highlighting a multi-megabyte file locks the main thread for seconds, and
 * the whole point of a preview is that it's cheap.
 */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export type FileContentState =
  | { status: "loading" }
  // the file exists but we won't render it (binary, too large)
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string }
  | { status: "loaded"; text: string };

function toSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Fetches a file's contents from `/fs/file`.
 *
 * Plain `fetch` rather than `useFetcher().load()`: the route streams a raw
 * `Response`, which a fetcher can't consume.
 *
 * Re-runs when `refreshToken` changes, so the panel's refresh button reloads
 * the open file along with the tree.
 */
export function useFileContent(
  path: string,
  fileName: string,
  refreshToken: number,
): FileContentState {
  const [state, setState] = useState<FileContentState>({ status: "loading" });

  useEffect(() => {
    // switching files must not leave the previous file's rows on screen while
    // the new one loads -- that reads as "this is the file you clicked"
    setState({ status: "loading" });

    if (isBinaryFileName(fileName)) {
      setState({
        status: "unsupported",
        message: "Binary file — preview not available.",
      });
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(
          `/fs/file?path=${encodeURIComponent(path)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          // the route sends plain-text error messages
          const message = await response.text();
          setState({
            status: "error",
            message: message || `Request failed (${response.status})`,
          });
          return;
        }

        // check the size *before* reading, so a huge file is never buffered.
        // aborting also tears down the server-side read stream.
        const size = Number(response.headers.get("Content-Length"));
        if (Number.isFinite(size) && size > MAX_PREVIEW_BYTES) {
          controller.abort();
          setState({
            status: "unsupported",
            message: `File is too large to preview (${toSizeLabel(size)}).`,
          });
          return;
        }

        const text = await response.text();

        // extension lists miss things; a NUL byte in the first chunk is the
        // usual heuristic for "this isn't text"
        if (text.slice(0, 8000).includes("\u0000")) {
          setState({
            status: "unsupported",
            message: "Binary file — preview not available.",
          });
          return;
        }

        setState({ status: "loaded", text });
      } catch (error) {
        // an abort is either our own size check or an unmount/file switch;
        // in both cases the state has already moved on
        if (controller.signal.aborted) return;

        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Failed to read file.",
        });
      }
    })();

    return () => controller.abort();
  }, [path, fileName, refreshToken]);

  return state;
}
