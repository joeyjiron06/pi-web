import { ChevronRight, File, Folder } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
import {
  isDirectoryError,
  type DirectoryResult,
} from "~/routes/fs/directory";
import type { FileItem, FolderItem } from "~/routes/fs/fs.types";
import { useFileExplorer } from "./file-explorer-context";
import { FileTreeMessageRow, useRowStyle } from "./file-tree-row";
import FileTreeSkeleton from "./file-tree-skeleton";

/** Both kinds, so a folder's listing is one request rather than two. */
const INCLUDE = "files,folders";

function toDirectoryUrl(path: string): string {
  return `/fs/directory?path=${encodeURIComponent(path)}&include=${INCLUDE}`;
}

/**
 * A file row. Clicking it opens the file in the viewer panel below the tree.
 *
 * A `<button>` rather than a `div` with a handler, so it's reachable by
 * keyboard -- the row is now the only way to open a file.
 */
const FileRow = memo(function FileRow({
  file,
  depth,
}: {
  file: FileItem;
  depth: number;
}) {
  const style = useRowStyle(depth);
  const { activeFile, selectFile } = useFileExplorer();

  const isActive = activeFile?.path === file.path;

  const handleClick = useCallback(() => {
    selectFile(file);
  }, [file, selectFile]);

  return (
    <button
      type="button"
      style={style}
      title={file.displayPath}
      onClick={handleClick}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "hover:bg-accent/50 flex h-7 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-sm",
        isActive && "bg-accent hover:bg-accent text-accent-foreground",
      )}
    >
      {/* spacer matching the folder chevron so file and folder labels align */}
      <span className="w-4 shrink-0" />
      <File className="text-muted-foreground size-3.5 shrink-0" />
      <span className="truncate">{file.name}</span>
    </button>
  );
});

/**
 * The contents of one directory, and the unit that owns a fetcher.
 *
 * Loads only once `isActive` (its parent is expanded) and then holds the
 * result for as long as it stays mounted -- which is why the parent keeps its
 * collapsible panel mounted while closed. Collapsing and re-expanding is
 * therefore free; only the refresh button re-lists.
 */
const FileTreeChildren = memo(function FileTreeChildren({
  path,
  depth,
  isActive,
}: {
  path: string;
  depth: number;
  isActive: boolean;
}) {
  const fetcher = useFetcher<DirectoryResult>();
  const { refreshToken } = useFileExplorer();

  const url = useMemo(() => toDirectoryUrl(path), [path]);

  // the token this instance has already requested. a ref rather than state
  // because writing it must not itself cause a render.
  const loadedTokenRef = useRef<number | undefined>(undefined);

  const { load } = fetcher;
  useEffect(() => {
    if (!isActive) return;
    if (loadedTokenRef.current === refreshToken) return;
    loadedTokenRef.current = refreshToken;
    load(url);
  }, [isActive, url, refreshToken, load]);

  const error = useMemo(
    () => (isDirectoryError(fetcher.data) ? fetcher.data.message : undefined),
    [fetcher.data],
  );

  // folders first, then files, each already sorted by the server
  const entries = useMemo(() => {
    const result = fetcher.data;
    if (!result || isDirectoryError(result)) return [];
    return [...result.folders, ...result.files];
  }, [fetcher.data]);

  // only the *first* load shows skeletons. a refresh keeps the existing rows
  // on screen (the panel's header spinner reports it instead), so the tree
  // doesn't collapse into placeholders on every refresh
  const isFirstLoad = isActive && fetcher.data === undefined;

  if (isFirstLoad) return <FileTreeSkeleton depth={depth} />;

  if (error) {
    return (
      <FileTreeMessageRow depth={depth} className="text-destructive">
        <span className="w-4 shrink-0" />
        <span className="truncate" title={error}>
          {error}
        </span>
      </FileTreeMessageRow>
    );
  }

  // nothing has been requested yet (collapsed and never opened)
  if (fetcher.data === undefined) return null;

  if (entries.length === 0) {
    return (
      <FileTreeMessageRow depth={depth}>
        <span className="w-4 shrink-0" />
        <span className="truncate italic">Empty folder</span>
      </FileTreeMessageRow>
    );
  }

  return (
    <>
      {entries.map((entry) =>
        entry.kind === "folder" ? (
          // keyed by absolute path so a re-listing can never reuse one
          // folder's fetcher (and cached contents) for a different folder
          <FileTreeFolder key={entry.path} folder={entry} depth={depth} />
        ) : (
          <FileRow key={entry.path} file={entry} depth={depth} />
        ),
      )}
    </>
  );
});

/**
 * A collapsible folder row plus its (lazily loaded) contents.
 */
const FileTreeFolder = memo(function FileTreeFolder({
  folder,
  depth,
}: {
  folder: FolderItem;
  depth: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const style = useRowStyle(depth);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <div
        style={style}
        title={folder.displayPath}
        className="hover:bg-accent/50 flex h-7 items-center gap-1.5 rounded-sm pr-2"
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm">
          <ChevronRight
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
          <Folder className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate">{folder.name}</span>
        </CollapsibleTrigger>
      </div>
      {/* `keepMounted` is load-bearing: unmounting on collapse would destroy
          every descendant fetcher, so re-expanding would refetch the whole
          subtree from scratch */}
      <CollapsibleContent keepMounted>
        <FileTreeChildren
          path={folder.path}
          depth={depth + 1}
          isActive={isOpen}
        />
      </CollapsibleContent>
    </Collapsible>
  );
});

export { FileTreeChildren, FileTreeFolder };
