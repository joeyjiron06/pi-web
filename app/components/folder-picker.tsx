import { FolderIcon, HouseIcon, StarIcon, FolderOpenIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Skeleton } from "~/components/ui/skeleton";
import { useCookie } from "~/hooks/use-cookie";
import type { DirectoryResult } from "~/routes/fs/directory";
import { isDirectoryError } from "~/routes/fs/directory";
import type { FolderItem } from "~/routes/fs/fs.types";

export const FAVORITES_COOKIE = "folder-favorites";

// cookies are capped at ~4KB total, so keep the list small
const MAX_FAVORITES = 20;

const HOME: FolderItem = {
  path: "~",
  displayPath: "~",
  name: "Home",
  kind: "folder",
};

type Props = {
  /** forwarded to the trigger so an external <Label htmlFor> can target it */
  id?: string;
  /**
   * when set, the selected path is submitted with the surrounding <form> under
   * this name. opt-in because this picker is also used inside dialogs (and
   * nested inside the worktree picker) where it must not contribute a field.
   */
  name?: string;
  folder?: FolderItem;
  recentFolders: readonly FolderItem[];
  onFolderChanged: (folder: FolderItem) => void;
};

export default function FolderPicker({
  id,
  name,
  folder,
  recentFolders,
  onFolderChanged,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          id={id}
          render={<Button variant="ghost" size="sm" className="max-w-72" />}
          aria-label="Folder"
        >
          <FolderIcon />
          <span className="truncate">{folder?.name ?? "Select folder"}</span>

          {name && (
            <input type="hidden" name={name} value={folder?.path ?? ""} />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-64" align="start">
          {recentFolders.map((recent) => (
            <DropdownMenuItem
              key={recent.path}
              onClick={() => onFolderChanged(recent)}
            >
              <FolderIcon />
              <span className="truncate" title={recent.path}>
                {recent.name}
              </span>
            </DropdownMenuItem>
          ))}

          {recentFolders.length > 0 && <DropdownMenuSeparator />}

          <DropdownMenuItem onClick={() => setDialogOpen(true)}>
            <FolderOpenIcon />
            <span>Select...</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <FolderPickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onFolderChanged={onFolderChanged}
      />
    </>
  );
}

type FolderPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFolderChanged: (folder: FolderItem) => void;
};

function FolderPickerDialog({
  open,
  onOpenChange,
  onFolderChanged,
}: FolderPickerDialogProps) {
  const fetcher = useFetcher<DirectoryResult>();
  const [favorites, setFavorites] = useCookie<FolderItem[]>(FAVORITES_COOKIE, {
    defaultValue: [HOME],
  });

  function navigate(path: string) {
    fetcher.load(`/fs/directory?path=${encodeURIComponent(path)}`);
  }

  // always (re)start at ~ when the dialog is opened
  useEffect(() => {
    if (open) {
      navigate("~");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const result = fetcher.data;
  const error = isDirectoryError(result) ? result.message : undefined;
  const listing = result && !isDirectoryError(result) ? result : undefined;

  // `idle` with no data yet == the very first load hasn't come back
  const isLoading = fetcher.state === "loading" || (!result && open);

  function addFavorite(item: FolderItem) {
    setFavorites((prev) => {
      if (prev.some((favorite) => favorite.path === item.path)) return prev;
      return [...prev, item].slice(-MAX_FAVORITES);
    });
  }

  function removeFavorite(item: FolderItem) {
    setFavorites((prev) =>
      prev.filter((favorite) => favorite.path !== item.path),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select folder</DialogTitle>
          <DialogDescription>
            {listing ? (
              <PathBreadcrumb path={listing.path} onNavigate={navigate} />
            ) : (
              "Browse for a folder"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-80 gap-3 border border-border">
          <nav className="w-44 shrink-0 overflow-y-auto border-r border-border p-1">
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Favorites
            </p>
            {favorites.map((favorite) => (
              <ContextMenu key={favorite.path}>
                <ContextMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-icon="inline-start"
                      title={favorite.path}
                      onClick={() => navigate(favorite.path)}
                      className="flex w-full justify-start"
                    />
                  }
                >
                  {favorite.path === HOME.path ? <HouseIcon /> : <FolderIcon />}
                  <span className="truncate">{favorite.name}</span>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    variant="destructive"
                    disabled={favorite.path === HOME.path}
                    onClick={() => removeFavorite(favorite)}
                  >
                    Remove from favorites
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-1">
            {isLoading ? (
              <FolderListSkeleton />
            ) : error ? (
              <p className="p-3 text-xs text-destructive">{error}</p>
            ) : !listing || listing.folders.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No folders</p>
            ) : (
              listing.folders.map((item) => (
                <ContextMenu key={item.path}>
                  <ContextMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        data-icon="inline-start"
                        type="button"
                        title={item.path}
                        onClick={() => navigate(item.path)}
                        className="flex justify-start w-full"
                      />
                    }
                  >
                    <FolderIcon />
                    <span className="truncate">{item.name}</span>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => addFavorite(item)}>
                      <StarIcon />
                      Add to favorites
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!listing}
            onClick={() => {
              if (!listing) return;
              onFolderChanged(listing.folder);
              onOpenChange(false);
            }}
          >
            Select folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderListSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-1" aria-label="Loading" role="status">
      {Array.from({ length: 8 }).map((_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <Skeleton key={index} className="h-6 w-full" />
      ))}
    </div>
  );
}

type PathBreadcrumbProps = {
  path: string;
  onNavigate: (path: string) => void;
};

function PathBreadcrumb({ path, onNavigate }: PathBreadcrumbProps) {
  const crumbs = toCrumbs(path);

  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap overflow-x-auto">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;

          return (
            <BreadcrumbItem key={crumb.path}>
              {isLast ? (
                <BreadcrumbPage title={crumb.path}>{crumb.name}</BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink
                    title={crumb.path}
                    render={
                      <button
                        type="button"
                        onClick={() => onNavigate(crumb.path)}
                      />
                    }
                  >
                    {crumb.name}
                  </BreadcrumbLink>
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Splits an absolute path into clickable segments. Handles both POSIX (`/a/b`)
 * and Windows (`C:\a\b`) paths, since the client has no `node:path`.
 */
export function toCrumbs(absolutePath: string) {
  const separator = absolutePath.includes("\\") ? "\\" : "/";
  const segments = absolutePath.split(separator).filter(Boolean);
  const crumbs: { name: string; path: string }[] = [];

  if (separator === "/") {
    crumbs.push({ name: "/", path: "/" });
  }

  let accumulated = "";
  for (const segment of segments) {
    accumulated = accumulated
      ? `${accumulated}${separator}${segment}`
      : separator === "/"
        ? `/${segment}`
        : segment;

    crumbs.push({
      // a bare drive letter ("C:") isn't a valid path, it needs the trailing slash
      name: segment,
      path: /^[a-zA-Z]:$/.test(accumulated) ? `${accumulated}\\` : accumulated,
    });
  }

  return crumbs;
}
