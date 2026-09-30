import { ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import GitCommitForm from "~/components/git/git-commit-form";
import GitFileTree, {
  type GitRowActions,
} from "~/components/git/git-file-tree";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
import type { GitStatusResult } from "~/routes/git/status";
import type { GitDiffSide, GitTreeNode } from "~/services/git.server";
import {
  type ActiveDiff,
  GitChangesProvider,
} from "./git-changes-context";
import GitDiffViewer from "./git-diff-viewer";

/** Total files beneath a set of tree nodes, for the header count. */
function countFiles(nodes: GitTreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.kind === "directory" ? node.fileCount : 1),
    0,
  );
}

/** The file node for `path`, or `null` when this set of trees has no such row. */
function findFile(
  nodes: GitTreeNode[],
  path: string,
): Extract<GitTreeNode, { kind: "file" }> | null {
  for (const node of nodes) {
    if (node.kind === "file") {
      if (node.path === path) return node;
      continue;
    }
    const found = findFile(node.children, path);
    if (found) return found;
  }
  return null;
}

/** The section a change moves to when it is staged, and vice versa. */
const OPPOSITE_SIDE: Record<GitDiffSide, GitDiffSide> = {
  staged: "unstaged",
  unstaged: "staged",
};

/**
 * A collapsible group of changes ("Staged Changes", "Changes", ...).
 * Renders nothing when empty, so a typical session shows only "Changes".
 */
function ChangeSection({
  title,
  nodes,
  repoRoot,
  side,
  actions = "none",
}: {
  title: string;
  nodes: GitTreeNode[];
  repoRoot: string;
  /** `null` leaves the rows non-clickable; see `GitFileTree`. */
  side: GitDiffSide | null;
  actions?: GitRowActions;
}) {
  const [isOpen, setIsOpen] = useState(true);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  const fileCount = useMemo(() => countFiles(nodes), [nodes]);

  if (nodes.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger className="hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left">
        <ChevronRight
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            isOpen && "rotate-90",
          )}
        />
        <span className="truncate text-xs font-semibold tracking-wide uppercase">
          {title}
        </span>
        <span className="flex-1" />
        <span className="text-muted-foreground shrink-0 font-mono text-xs">
          {fileCount}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <GitFileTree
          nodes={nodes}
          actions={actions}
          repoRoot={repoRoot}
          side={side}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Working tree status for the repo containing `cwd`, split into staged,
 * unstaged and conflicted groups, beside a diff viewer for the file that's
 * currently selected.
 *
 * Loads on mount and whenever `cwd` changes. Note the sidebar lives inside an
 * `<Activity>` and a tab panel, so this remounts (and refetches) each time the
 * Git tab is shown -- which is what keeps a long-lived session's status fresh.
 *
 * The viewer half of the split is *absent* (not collapsed) until a file is
 * clicked, so the tree gets the full width in the common case.
 */
export default function GitChangesPanel({ cwd }: { cwd: string }) {
  const fetcher = useFetcher<GitStatusResult>();
  const [activeDiff, setActiveDiff] = useState<ActiveDiff | null>(null);
  // bumped by the refresh button; the viewer watches it so a manual refresh
  // re-reads the open diff and not just the tree
  const [refreshToken, setRefreshToken] = useState(0);

  // `fetcher.load` is stable, but listing it satisfies the lint rule and costs
  // nothing since the effect is keyed on `cwd`
  const { load } = fetcher;
  useEffect(() => {
    if (!cwd) return;
    load(`/git/status?directory=${encodeURIComponent(cwd)}`);
  }, [cwd, load]);

  // same load the mount effect runs, so a manual refresh and an automatic
  // revalidation are indistinguishable to the rest of the panel
  const handleRefresh = useCallback(() => {
    if (!cwd) return;
    setRefreshToken((token) => token + 1);
    load(`/git/status?directory=${encodeURIComponent(cwd)}`);
  }, [cwd, load]);

  const selectDiff = useCallback((diff: ActiveDiff) => {
    setActiveDiff(diff);
  }, []);

  const clearDiff = useCallback(() => {
    setActiveDiff(null);
  }, []);

  const groups = useMemo(() => {
    if (!fetcher.data?.isGitRepo) {
      return { staged: [], unstaged: [], conflicted: [] };
    }
    const { staged, unstaged, conflicted } = fetcher.data;
    return { staged, unstaged, conflicted };
  }, [fetcher.data]);

  // staging a file moves it from "Changes" to "Staged Changes" (and unstaging
  // moves it back). The diff stays open and follows it across, re-fetching
  // against the other pair of blobs, because the user is still looking at the
  // same file -- closing the viewer would punish them for staging.
  //
  // Only a change that leaves *both* sections (discarded, or committed) closes
  // it, since there is then no diff left to show.
  useEffect(() => {
    if (!activeDiff) return;
    // mid-flight the trees are stale, and acting on them would close a diff
    // the very refetch is about to justify
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (findFile(groups[activeDiff.side], activeDiff.path)) return;

    const otherSide = OPPOSITE_SIDE[activeDiff.side];
    const moved = findFile(groups[otherSide], activeDiff.path);

    if (!moved) {
      setActiveDiff(null);
      return;
    }

    // `originalPath` is re-read from the node rather than carried over: a
    // rename reports its old path on whichever side it currently sits, so
    // reusing the previous one could diff against a path that side never had
    setActiveDiff({
      path: moved.path,
      originalPath: moved.change.originalPath,
      side: otherSide,
      name: moved.name,
    });
  }, [activeDiff, groups, fetcher.state, fetcher.data]);

  const isClean = useMemo(
    () =>
      groups.staged.length === 0 &&
      groups.unstaged.length === 0 &&
      groups.conflicted.length === 0,
    [groups],
  );

  const isLoading = fetcher.state === "loading";
  const hasLoaded = fetcher.data !== undefined;
  const isGitRepo = fetcher.data?.isGitRepo === true;

  // the stage action posts against the repo root, not `cwd`: every path in the
  // status tree is reported relative to the root, so a subdirectory cwd would
  // resolve them against the wrong base
  const repoRoot = useMemo(
    () => (fetcher.data?.isGitRepo ? fetcher.data.repoRoot : ""),
    [fetcher.data],
  );

  const contextValue = useMemo(
    () => ({ activeDiff, selectDiff, clearDiff }),
    [activeDiff, selectDiff, clearDiff],
  );

  return (
    <GitChangesProvider value={contextValue}>
      {/* horizontal: the diff sits to the *left* of the tree, matching the
          files tab. Panel order in the DOM is what decides that */}
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        {activeDiff && repoRoot && (
          <>
            <ResizablePanel defaultSize="60%" minSize="20%">
              <GitDiffViewer
                diff={activeDiff}
                repoRoot={repoRoot}
                refreshToken={refreshToken}
                onClose={clearDiff}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        <ResizablePanel
          // no `defaultSize`: with the viewer absent the tree is the only
          // panel and takes the full width
          minSize="20%"
          className="flex min-h-0 flex-col"
        >
          <ScrollArea className="h-full">
            <div className="flex flex-col">
              {/* its own row above the commit form: the form's own padding would
                  otherwise push the button off the panel's top-right corner */}
              <div className="flex justify-end px-2 pt-2">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Refresh changes"
                        onClick={handleRefresh}
                        disabled={!cwd || isLoading}
                      />
                    }
                  >
                    {/* the icon spins rather than being swapped for a Spinner, so
                        the row can't shift while a refresh is in flight */}
                    <RefreshCw className={cn(isLoading && "animate-spin")} />
                  </TooltipTrigger>
                  <TooltipContent>Refresh changes</TooltipContent>
                </Tooltip>
              </div>

              {/* the form stays mounted across every state so an in-progress
                  message is never lost to a refetch that finds, say, a
                  momentarily clean tree */}
              {isGitRepo ? (
                <GitCommitForm
                  hasStagedChanges={groups.staged.length > 0}
                  repoRoot={repoRoot}
                />
              ) : null}

              {!hasLoaded ? (
                <p className="text-muted-foreground p-4 text-sm">
                  {isLoading ? "Loading changes…" : "No working directory."}
                </p>
              ) : !isGitRepo ? (
                <p className="text-muted-foreground p-4 text-sm">
                  Not a git repository.
                </p>
              ) : isClean ? (
                <p className="text-muted-foreground p-4 text-sm">
                  No changes — working tree clean.
                </p>
              ) : (
                <div className="flex flex-col gap-1 p-1">
                  {/* conflicts first: they block committing, so they need
                      attention before anything else in the panel */}
                  <ChangeSection
                    title="Merge Conflicts"
                    nodes={groups.conflicted}
                    repoRoot={repoRoot}
                    side={null}
                  />
                  <ChangeSection
                    title="Staged Changes"
                    nodes={groups.staged}
                    actions="unstage"
                    repoRoot={repoRoot}
                    side="staged"
                  />
                  <ChangeSection
                    title="Changes"
                    nodes={groups.unstaged}
                    actions="stage"
                    repoRoot={repoRoot}
                    side="unstaged"
                  />
                </div>
              )}
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </GitChangesProvider>
  );
}
