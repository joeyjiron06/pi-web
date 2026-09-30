import {
  Link2Icon,
  Link2OffIcon,
  SplitIcon,
  LaptopIcon,
  PlusIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import FolderPicker from "~/components/folder-picker";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { FolderItem } from "~/routes/fs/fs.types";
import {
  displayPath,
  joinPath,
  parentOf,
  resolveWorktreePath,
  siblingWorktreePath,
  toFolderName,
  type Worktree,
} from "~/lib/worktree-path";

// path helpers live in ~/lib/worktree-path so the server can recompute the
// exact same `auto` path this picker previews. re-exported for existing imports.
export {
  resolveWorktreePath,
  siblingWorktreePath,
  toFolderName,
  type Worktree,
};

type Props = {
  /** where the session runs: the project itself, or a linked worktree */
  worktree: Worktree;
  onWorktreeChanged: (worktree: Worktree) => void;
  /** branch a newly created worktree will be based off of */
  branch: string;
  /** root git repo the worktree belongs to */
  projectPath: string;
};

export default function WorktreePicker({
  worktree,
  onWorktreeChanged,
  branch,
  projectPath,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const isLocal = worktree.type === "local";

  /**
   * so the radio group behaves like a radio group: picking "Work locally"
   * shouldn't throw away the worktree you just configured.
   */
  const [lastWorktree, setLastWorktree] = useState<Worktree | null>(
    worktree.type === "worktree" ? worktree : null,
  );

  // switching projects invalidates a remembered manual path (it points into the
  // old project's parent), so forget it. adjusting state during render is the
  // documented way to reset state on a prop change.
  const [lastProjectPath, setLastProjectPath] = useState(projectPath);
  if (lastProjectPath !== projectPath) {
    setLastProjectPath(projectPath);
    setLastWorktree(null);
  }

  const pending = isLocal ? lastWorktree : worktree;
  const pendingPath = pending
    ? resolveWorktreePath(pending, projectPath, branch)
    : "";

  // the `Worktree` union has to travel as flat form fields
  const fields = useMemo(
    () => ({
      type: worktree.type,
      source: worktree.type === "worktree" ? worktree.source : "",
      path:
        worktree.type === "worktree" && worktree.source === "manual"
          ? worktree.path
          : "",
    }),
    [worktree],
  );

  function handleWorktreeChanged(next: Worktree) {
    if (next.type === "worktree") setLastWorktree(next);
    onWorktreeChanged(next);
  }

  return (
    <>
      {/* submitted with the surrounding <form>. this picker only renders for git
          repos, so for a plain folder these fields are absent entirely and
          `worktreeType` falls back to "local" server side. */}
      <input type="hidden" name="worktreeType" value={fields.type} />
      <input type="hidden" name="worktreeSource" value={fields.source} />
      <input type="hidden" name="worktreePath" value={fields.path} />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" className="max-w-72" />}
          aria-label="Worktree"
        >
          {isLocal ? <LaptopIcon /> : <SplitIcon className="rotate-90" />}
          <span className="truncate">
            {isLocal ? "Local" : displayPath(pendingPath)}
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-64" align="start">
          <DropdownMenuRadioGroup
            value={worktree.type}
            onValueChange={(type) => {
              if (type === worktree.type) return;
              if (type === "local") onWorktreeChanged({ type: "local" });
              else if (pending) onWorktreeChanged(pending);
            }}
          >
            <DropdownMenuRadioItem value="local" closeOnClick>
              <LaptopIcon />
              <span className="truncate">Work locally</span>
            </DropdownMenuRadioItem>

            {pending && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuRadioItem value="worktree" closeOnClick>
                  <SplitIcon className="rotate-90" />
                  <span className="truncate" title={pendingPath}>
                    {displayPath(pendingPath)}
                  </span>
                </DropdownMenuRadioItem>
              </>
            )}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            disabled={!projectPath}
            onClick={() => setDialogOpen(true)}
          >
            <PlusIcon />
            <span className="truncate">Create new worktree</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialogOpen && (
        <CreateWorktreeDialog
          projectPath={projectPath}
          branch={branch}
          onConfirm={(next) => {
            handleWorktreeChanged(next);
            setDialogOpen(false);
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}

type CreateWorktreeDialogProps = {
  /** the root path of the project */
  projectPath: string;
  /** the current branch name */
  branch: string;
  onConfirm: (worktree: Worktree) => void;
  onClose: () => void;
};

export function CreateWorktreeDialog({
  projectPath,
  branch,
  onConfirm,
  onClose,
}: CreateWorktreeDialogProps) {
  const [auto, setAuto] = useState(true);
  /** manual mode splits the path so each half can be edited on its own */
  const [parentPath, setParentPath] = useState("");
  const [folderName, setFolderName] = useState("");

  const autoPath = useMemo(
    () => siblingWorktreePath(projectPath, branch),
    [projectPath, branch],
  );

  const manualPath = useMemo(
    () => (parentPath ? joinPath(parentPath, folderName) : folderName),
    [parentPath, folderName],
  );

  const path = auto ? autoPath : manualPath;

  // while auto is on, keep the manual fields mirroring what auto would produce
  // so flipping the toggle starts from the same place instead of empty
  useEffect(() => {
    if (!auto) return;
    setParentPath(parentOf(projectPath));
    setFolderName(toFolderName(branch) || "worktree");
  }, [auto, projectPath, branch]);

  const parentFolder = useMemo<FolderItem | undefined>(
    () =>
      parentPath
        ? {
            path: parentPath,
            displayPath: parentPath,
            name: displayPath(parentPath),
            kind: "folder",
          }
        : undefined,
    [parentPath],
  );

  const handleToggleAuto = useCallback(() => setAuto((prev) => !prev), []);

  const handleParentChanged = useCallback((folder: FolderItem) => {
    setParentPath(folder.path);
  }, []);

  const handleFolderNameChanged = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setFolderName(event.target.value);
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    onConfirm(
      auto
        ? { type: "worktree", source: "auto" }
        : { type: "worktree", source: "manual", path: path.trim() },
    );
  }, [auto, path, onConfirm]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create new worktree</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="worktree-folder">Folder</Label>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={auto}
                    onClick={handleToggleAuto}
                  />
                }
              >
                {auto ? <Link2Icon /> : <Link2OffIcon />}
                <span>{auto ? "Auto" : "Manual"}</span>
              </TooltipTrigger>
              <TooltipContent>
                Auto creates the worktree in a sibling directory of the project,
                using the current branch name as the folder name. Manual lets
                you pick the directory it lives in.
              </TooltipContent>
            </Tooltip>
          </div>

          {auto ? (
            <Input
              id="worktree-folder"
              value={autoPath}
              readOnly
              placeholder="Path to the new worktree"
            />
          ) : (
            <>
              <Label htmlFor="worktree-parent">Parent folder</Label>
              {/* the trigger is a shrink-to-fit button, so a flex row keeps it
                  left aligned instead of stretched/centered by the column */}
              <div className="flex">
                <FolderPicker
                  id="worktree-parent"
                  folder={parentFolder}
                  recentFolders={[]}
                  onFolderChanged={handleParentChanged}
                />
              </div>

              <Label htmlFor="worktree-folder">Folder name</Label>
              <Input
                id="worktree-folder"
                value={folderName}
                placeholder="Name of the new worktree folder"
                onChange={handleFolderNameChanged}
              />

              <p
                className="truncate text-xs text-muted-foreground"
                title={manualPath}
              >
                {manualPath || "Pick a parent folder and a name"}
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!path.trim() || (!auto && !folderName.trim())}
            onClick={handleConfirm}
          >
            Create worktree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
