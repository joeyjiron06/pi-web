import { ChevronRight, File, Folder, Minus, Plus, Undo2 } from "lucide-react";
import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { toast } from "~/components/ui/toast";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { GitPathsResult } from "~/routes/git/git.types";
import type {
  EffectiveStatus,
  GitDiffSide,
  GitTreeNode,
} from "~/services/git.server";
import { isSameDiff, useGitChanges } from "./git-changes-context";

/**
 * Every repo-relative path a row acts on, including the pre-rename path of a
 * rename. Acting on only the new path would leave the matching deletion on the
 * other side, so the change would appear in both sections at once.
 */
function collectRowPaths(node: GitTreeNode): string[] {
  if (node.kind === "file") {
    return node.change.originalPath
      ? [node.path, node.change.originalPath]
      : [node.path];
  }
  // leaf paths rather than the directory itself: a directory pathspec would
  // also sweep up changes the row never showed
  return node.children.flatMap(collectRowPaths);
}

/**
 * Single-letter badge and colour per status. Deleted borrows `destructive`;
 * the rest use palette colours picked for contrast in both themes, since the
 * theme defines no success/warning tokens.
 */
const STATUS_DISPLAY: Record<
  EffectiveStatus,
  { letter: string; className: string; label: string }
> = {
  modified: {
    letter: "M",
    className: "text-amber-600 dark:text-amber-500",
    label: "Modified",
  },
  added: {
    letter: "A",
    className: "text-emerald-600 dark:text-emerald-500",
    label: "Added",
  },
  untracked: {
    letter: "U",
    className: "text-emerald-600 dark:text-emerald-500",
    label: "Untracked",
  },
  deleted: {
    letter: "D",
    className: "text-destructive",
    label: "Deleted",
  },
  renamed: {
    letter: "R",
    className: "text-sky-600 dark:text-sky-500",
    label: "Renamed",
  },
  copied: {
    letter: "C",
    className: "text-sky-600 dark:text-sky-500",
    label: "Copied",
  },
  conflicted: {
    letter: "!",
    className: "text-destructive font-bold",
    label: "Conflicted",
  },
  typeChanged: {
    letter: "T",
    className: "text-violet-600 dark:text-violet-500",
    label: "Type changed",
  },
  ignored: {
    letter: "I",
    className: "text-muted-foreground",
    label: "Ignored",
  },
};

/** Indent per depth level, applied as padding so the hover row still spans full width. */
const INDENT_PER_LEVEL_PX = 12;

/**
 * Which set of hover actions a row offers.
 * - `none`: read-only, e.g. the merge conflicts section
 * - `unstage`: staged rows -- a single button to take the change back out
 * - `stage`: unstaged rows -- discard, plus stage
 */
export type GitRowActions = "none" | "stage" | "unstage";

/**
 * A single hover action. Ghost + icon-only, labelled by both a tooltip and an
 * `aria-label`, since base-ui tooltips don't supply an accessible name.
 *
 * Extra props are forwarded to the tooltip trigger, which merges them onto the
 * underlying button. That forwarding is load-bearing: `AlertDialogTrigger`
 * renders this component via `render={...}` and clones its own `onClick`, ref
 * and ARIA attributes onto it, so swallowing them would leave the dialog
 * unable to open.
 */
function RowActionButton({
  label,
  type = "button",
  disabled,
  children,
  ...props
}: {
  label: string;
  type?: "button" | "submit";
  disabled?: boolean;
  children: React.ReactNode;
} & Omit<React.ComponentProps<"button">, "type" | "disabled" | "children">) {
  return (
    <Tooltip>
      <TooltipTrigger
        {...props}
        render={
          <Button
            type={type}
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A row button that posts a set of paths to a git-mutating route.
 *
 * `fetcher.Form` rather than `Form`: a plain form navigates, which would tear
 * down the panel's collapsed/expanded state on every click. The submission
 * still revalidates the panel's `/git/status` fetcher, so no manual refetch is
 * needed.
 *
 * `directory` is the repo root because status paths are root-relative.
 *
 * Pass `confirmDescription` for destructive routes: the button then opens an
 * alert dialog instead of submitting, and only the dialog's action button
 * posts.
 */
function RowMutationForm({
  route,
  label,
  errorTitle,
  icon,
  paths,
  repoRoot,
  confirmDescription,
}: {
  route: "/git/stage" | "/git/unstage" | "/git/discard";
  label: string;
  errorTitle: string;
  icon: React.ReactNode;
  paths: string[];
  repoRoot: string;
  confirmDescription?: string;
}) {
  const fetcher = useFetcher<GitPathsResult>();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // the dialog is portalled out of the form, so the confirm button is wired
  // back to it by id -- the HTML `form` attribute works across the portal,
  // where nesting would not
  const formId = useId();

  const action = useMemo(
    () => `${route}?directory=${encodeURIComponent(repoRoot)}`,
    [route, repoRoot],
  );

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    // keyed off the result object rather than the message: retrying and
    // failing the same way should toast again
    if (!result.ok) {
      toast.add({ title: errorTitle, description: result.error, type: "error" });
      return;
    }
    if (result.failed.length === 0) return;
    const attempted = result.applied.length + result.failed.length;
    toast.add({
      title: `${errorTitle} (${result.failed.length} of ${attempted} files)`,
      description: result.failed
        .map((failure) => `${failure.path}: ${failure.error}`)
        .join("\n"),
      type: "error",
    });
    // `errorTitle` is a literal from the caller, so this is effectively keyed
    // on the result alone
  }, [fetcher.data, errorTitle]);

  const handleConfirmOpenChange = useCallback((open: boolean) => {
    setIsConfirmOpen(open);
  }, []);

  // closes the dialog without cancelling the submit: the state update is
  // queued, so the button's native submit still reaches the form
  const handleConfirm = useCallback(() => {
    setIsConfirmOpen(false);
  }, []);

  const isPending = fetcher.state !== "idle";

  const button = (
    <RowActionButton
      label={label}
      type={confirmDescription ? "button" : "submit"}
      disabled={isPending}
    >
      {/* the spinner is pinned to the same `size-3` the button forces on the
          icon, so swapping them can't shift the row. `aria-hidden` because
          the button's own `aria-label` already names the control, and the
          Spinner's default `role="status"` would fight it */}
      {isPending ? (
        <Spinner
          className="size-3"
          role={undefined}
          aria-label={undefined}
          aria-hidden
        />
      ) : (
        icon
      )}
    </RowActionButton>
  );

  return (
    <fetcher.Form
      id={formId}
      method="post"
      action={action}
      className="contents"
    >
      {paths.map((path) => (
        <input key={path} type="hidden" name="files" value={path} />
      ))}
      {confirmDescription ? (
        <AlertDialog open={isConfirmOpen} onOpenChange={handleConfirmOpenChange}>
          <AlertDialogTrigger render={button} />
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{label}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {/* `form` + `type="submit"` rather than an onClick handler, so the
                  post stays a real form submission through the fetcher */}
              <AlertDialogAction
                type="submit"
                form={formId}
                variant="destructive"
                onClick={handleConfirm}
              >
                {label}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        button
      )}
    </fetcher.Form>
  );
}

/**
 * Hover actions for a row, revealed on hover.
 *
 * Kept in the DOM at all times (hidden with opacity, not unmounted) so the
 * layout never shifts on hover and the buttons stay reachable by keyboard --
 * `group-focus-within` brings them back for tab users.
 *
 * Every action here is wired: stage, unstage and discard.
 */
function RowActions({
  actions,
  stageLabel,
  unstageLabel,
  discardLabel,
  paths,
  repoRoot,
}: {
  actions: GitRowActions;
  stageLabel: string;
  unstageLabel: string;
  discardLabel: string;
  paths: string[];
  repoRoot: string;
}) {
  if (actions === "none") return null;

  return (
    <div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
      {actions === "unstage" ? (
        <RowMutationForm
          route="/git/unstage"
          label={unstageLabel}
          errorTitle="Couldn't unstage changes"
          icon={<Minus />}
          paths={paths}
          repoRoot={repoRoot}
        />
      ) : (
        <>
          <RowMutationForm
            route="/git/discard"
            label={discardLabel}
            errorTitle="Couldn't discard changes"
            icon={<Undo2 />}
            paths={paths}
            repoRoot={repoRoot}
            confirmDescription={`This permanently throws away the working-tree changes to ${
              paths.length === 1 ? "1 file" : `${paths.length} files`
            }. It cannot be undone.`}
          />
          <RowMutationForm
            route="/git/stage"
            label={stageLabel}
            errorTitle="Couldn't stage changes"
            icon={<Plus />}
            paths={paths}
            repoRoot={repoRoot}
          />
        </>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  title,
}: {
  status: EffectiveStatus;
  title?: string;
}) {
  const display = STATUS_DISPLAY[status];
  return (
    <span
      title={title ?? display.label}
      className={cn("shrink-0 font-mono text-xs", display.className)}
    >
      {display.letter}
    </span>
  );
}

const FileRow = memo(function FileRow({
  node,
  depth,
  actions,
  repoRoot,
  side,
}: {
  node: Extract<GitTreeNode, { kind: "file" }>;
  depth: number;
  actions: GitRowActions;
  repoRoot: string;
  side: GitDiffSide | null;
}) {
  const { activeDiff, selectDiff } = useGitChanges();

  const rowPaths = useMemo(() => collectRowPaths(node), [node]);

  const style = useMemo(
    () => ({ paddingLeft: `${depth * INDENT_PER_LEVEL_PX + 8}px` }),
    [depth],
  );

  const title = useMemo(() => {
    const { label } = STATUS_DISPLAY[node.status];
    const renamedFrom = node.change.originalPath
      ? ` from ${node.change.originalPath}`
      : "";
    return `${node.path} — ${label}${renamedFrom}`;
  }, [node]);

  const isActive = useMemo(
    () => (side ? isSameDiff(activeDiff, { path: node.path, side }) : false),
    [activeDiff, node.path, side],
  );

  const handleClick = useCallback(() => {
    if (!side) return;
    selectDiff({
      path: node.path,
      originalPath: node.change.originalPath,
      side,
      name: node.name,
    });
  }, [selectDiff, node, side]);

  return (
    <div
      style={style}
      className={cn(
        "group/row hover:bg-accent/50 flex h-7 items-center gap-1.5 rounded-sm pr-2 text-sm",
        isActive && "bg-accent",
      )}
    >
      {/* a button rather than a click handler on the row: the row also hosts
          the action buttons, and a nested-interactive div would swallow their
          keyboard focus. `side === null` (merge conflicts) leaves it disabled,
          because `:<path>` is ambiguous for an unmerged file -- there are
          three index stages and no single "before" to diff against */}
      <button
        type="button"
        title={title}
        onClick={handleClick}
        disabled={!side}
        aria-current={isActive ? "true" : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
      >
        {/* spacer matching the directory chevron so file and folder labels align */}
        <span className="w-4 shrink-0" />
        <File className="text-muted-foreground size-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
      <RowActions
        actions={actions}
        stageLabel="Stage file"
        unstageLabel="Unstage file"
        discardLabel="Discard file"
        paths={rowPaths}
        repoRoot={repoRoot}
      />
      <StatusBadge status={node.status} title={title} />
    </div>
  );
});

const DirectoryRow = memo(function DirectoryRow({
  node,
  depth,
  actions,
  repoRoot,
  side,
}: {
  node: Extract<GitTreeNode, { kind: "directory" }>;
  depth: number;
  actions: GitRowActions;
  repoRoot: string;
  side: GitDiffSide | null;
}) {
  // change sets are small, so everything starts expanded
  const [isOpen, setIsOpen] = useState(true);

  const rowPaths = useMemo(() => collectRowPaths(node), [node]);

  const style = useMemo(
    () => ({ paddingLeft: `${depth * INDENT_PER_LEVEL_PX + 8}px` }),
    [depth],
  );

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      {/* the trigger and the action buttons are siblings rather than nested:
          CollapsibleTrigger renders a <button>, and a button may not contain
          other buttons */}
      <div
        style={style}
        className="group/row hover:bg-accent/50 flex h-7 items-center gap-1.5 rounded-sm pr-2"
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm">
          <ChevronRight
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
          <Folder className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate">{node.name}</span>
        </CollapsibleTrigger>
        {/* the trailing "changes" wording reads the same for a folder, so unlike
            the stage label it needs no per-kind variant */}
        <RowActions
          actions={actions}
          stageLabel="Stage folder"
          unstageLabel="Unstage folder"
          discardLabel="Discard folder"
          paths={rowPaths}
          repoRoot={repoRoot}
        />
        {/* folders show a single neutral dot rather than a letter or count:
            `bg-current` picks up the modified colour from the shared
            STATUS_DISPLAY entry, so the dot can't drift from the `M` badge */}
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full bg-current opacity-50",
            STATUS_DISPLAY.modified.className,
          )}
        />
      </div>
      <CollapsibleContent>
        <GitFileTree
          nodes={node.children}
          depth={depth + 1}
          actions={actions}
          repoRoot={repoRoot}
          side={side}
        />
      </CollapsibleContent>
    </Collapsible>
  );
});

/**
 * Renders a pre-built git change tree. Purely presentational -- the tree is
 * built server-side in `git.server.ts` and fetched by `GitChangesPanel`.
 *
 * `actions` selects the hover-revealed row buttons: the unstaged "Changes"
 * section passes `stage`, the "Staged Changes" section passes `unstage`.
 *
 * `side` says which pair of blobs a file row opens in the diff viewer. `null`
 * makes the rows non-clickable, which is what the merge-conflicts section
 * wants -- an unmerged path has three index stages and no single "before".
 */
export default function GitFileTree({
  nodes,
  depth = 0,
  actions = "none",
  repoRoot,
  side,
}: {
  nodes: GitTreeNode[];
  depth?: number;
  actions?: GitRowActions;
  /** Repo root the stage action posts against; status paths are relative to it. */
  repoRoot: string;
  side: GitDiffSide | null;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "directory" ? (
          <DirectoryRow
            key={node.path}
            node={node}
            depth={depth}
            actions={actions}
            repoRoot={repoRoot}
            side={side}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            depth={depth}
            actions={actions}
            repoRoot={repoRoot}
            side={side}
          />
        ),
      )}
    </>
  );
}
