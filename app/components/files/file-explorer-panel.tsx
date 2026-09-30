import { RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { FileItem } from "~/routes/fs/fs.types";
import { FileExplorerProvider } from "./file-explorer-context";
import { FileTreeChildren } from "./file-tree-folder";
import FileViewerPanel from "./file-viewer-panel";

/**
 * Last segment of a path, for the header label.
 *
 * Splits on both separators: `cwd` is produced server-side and is native, so
 * it may be Windows-style, and this is the only place the client inspects it.
 */
function toFolderName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

/**
 * The Files tab: a lazy file tree rooted at the session's working directory,
 * beside a viewer for the file that's currently selected.
 *
 * The root listing is always active, so the top level loads on mount; every
 * folder below it fetches only once it's expanded, and caches the result in
 * its own fetcher for as long as it stays mounted.
 *
 * The viewer half of the split is *absent* (not collapsed) until a file is
 * clicked, so the tree gets the full width in the common case.
 */
export default function FileExplorerPanel({ cwd }: { cwd: string }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [activeFile, setActiveFile] = useState<FileItem | null>(null);

  const handleRefresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  const selectFile = useCallback((file: FileItem) => {
    setActiveFile(file);
  }, []);

  const clearActiveFile = useCallback(() => {
    setActiveFile(null);
  }, []);

  const rootName = useMemo(() => toFolderName(cwd), [cwd]);

  const contextValue = useMemo(
    () => ({ refreshToken, activeFile, selectFile, clearActiveFile }),
    [refreshToken, activeFile, selectFile, clearActiveFile],
  );

  if (!cwd) {
    return (
      <p className="text-muted-foreground p-4 text-sm">No working directory.</p>
    );
  }

  return (
    <FileExplorerProvider value={contextValue}>
      {/* horizontal: the viewer sits to the *left* of the tree. Panel order in
          the DOM is what decides that, so the viewer is rendered first */}
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        {activeFile && (
          <>
            <ResizablePanel defaultSize="55%" minSize="20%">
              {/* not keyed on the path: the viewer's Monaco instance swaps
                  models when the file changes, which is cheaper (and keeps
                  per-file scroll position) compared to a full remount */}
              <FileViewerPanel
                file={activeFile}
                refreshToken={refreshToken}
                onClose={clearActiveFile}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        <ResizablePanel
          // no `defaultSize`: with the viewer absent the tree is the only
          // panel and takes the full width; when the viewer appears it claims
          // its 55% and the tree keeps the rest
          minSize="20%"
          className="flex min-h-0 flex-col"
        >
          <div className="flex shrink-0 items-center gap-2 px-2 pt-2 pb-1">
            <span
              title={cwd}
              className="text-muted-foreground min-w-0 flex-1 truncate px-1 text-xs font-semibold tracking-wide uppercase"
            >
              {rootName}
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Refresh files"
                    onClick={handleRefresh}
                  />
                }
              >
                <RefreshCw />
              </TooltipTrigger>
              <TooltipContent>Refresh files</TooltipContent>
            </Tooltip>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col p-1">
              {/* keyed on `cwd` so switching sessions/worktrees drops the whole
                  cached tree rather than showing the previous project's folders */}
              <FileTreeChildren key={cwd} path={cwd} depth={0} isActive />
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </FileExplorerProvider>
  );
}
