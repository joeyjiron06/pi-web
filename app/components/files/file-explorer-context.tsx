import { createContext, useContext } from "react";
import type { FileItem } from "~/routes/fs/fs.types";

/**
 * Shared state for a file explorer subtree.
 *
 * Context rather than props because the tree is arbitrarily deep and every
 * level would otherwise have to forward the same values untouched.
 *
 * `refreshToken` is bumped by the panel's refresh button. Each mounted folder
 * watches it and re-lists itself, which is the only way the tree refetches --
 * `/fs/directory` opts out of automatic fetcher revalidation, so an unrelated
 * git action can't stampede every open folder at once.
 *
 * `activeFile` is the file currently open in the viewer. Held here rather than
 * threaded down because the row that sets it can be at any depth, and every
 * row needs to know whether *it* is the active one.
 */
export type FileExplorerContextValue = {
  refreshToken: number;

  // null until a file is clicked; the viewer panel is hidden while it is
  activeFile: FileItem | null;

  selectFile: (file: FileItem) => void;
  clearActiveFile: () => void;
};

const FileExplorerContext = createContext<FileExplorerContextValue>({
  refreshToken: 0,
  activeFile: null,
  selectFile: () => {},
  clearActiveFile: () => {},
});

export const FileExplorerProvider = FileExplorerContext.Provider;

export function useFileExplorer(): FileExplorerContextValue {
  return useContext(FileExplorerContext);
}
