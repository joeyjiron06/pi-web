import BranchPicker from "~/components/branch-picker";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** branches the new branch can be based off of */
  branches: readonly string[];
  /** name of the branch being created */
  branch: string;
  onBranchChanged: (branch: string) => void;
  /** branch the new branch is created from */
  branchFrom: string;
  onBranchFromChanged: (branch: string) => void;
  /** pinned to the top of the "branch from" list */
  mainBranch?: string;
  onCreate: () => void;
};

export default function BranchCreateDialog({
  open,
  onOpenChange,
  branches,
  branch,
  onBranchChanged,
  branchFrom,
  onBranchFromChanged,
  mainBranch,
  onCreate,
}: Props) {
  const name = branch.trim();
  // git rejects these outright, so don't let the user submit them
  const invalid = name.length > 0 && /[\s~^:?*[\\]|\.\.|^\/|\/$/.test(name);
  const duplicate = branches.includes(name);
  const canCreate = name.length > 0 && !invalid && !duplicate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create and check out new branch</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreate) onCreate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-branch-name">Branch name</Label>
            <Input
              id="new-branch-name"
              autoFocus
              value={branch}
              placeholder="Branch name here"
              onChange={(event) => onBranchChanged(event.target.value)}
            />
            {invalid && (
              <p className="text-destructive">Not a valid branch name</p>
            )}
            {!invalid && duplicate && (
              <p className="text-destructive">That branch already exists</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Branch from</Label>
            <div className="self-start">
              <BranchPicker
                branches={branches}
                branch={branchFrom}
                mainBranch={mainBranch}
                onBranchChanged={onBranchFromChanged}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate}>
              Create branch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
