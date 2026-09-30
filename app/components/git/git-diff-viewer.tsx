import { Columns2, Rows2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import DelayedRender, { FAST_DELAY } from "~/components/delayed-render";
import { toMonacoLanguage } from "~/components/files/monaco-language";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { GitDiffResult } from "~/routes/git/git.types";
import type { GitDiffContent } from "~/services/git.server";
import type { ActiveDiff } from "./git-changes-context";
import GitDiffEditor from "./git-diff-editor";

const SIDE_LABEL: Record<ActiveDiff["side"], string> = {
  staged: "Staged",
  unstaged: "Working tree",
};

/**
 * The diff of the file currently selected in the changes tree.
 *
 * Mounted only while a diff is active. Refetches whenever the selection or
 * `refreshToken` changes, so the panel's refresh button re-reads the open diff
 * along with the status tree.
 */
export default function GitDiffViewer({
  diff,
  repoRoot,
  refreshToken,
  onClose,
}: {
  diff: ActiveDiff;
  repoRoot: string;
  refreshToken: number;
  onClose: () => void;
}) {
  const fetcher = useFetcher<GitDiffResult>();
  // inline by default: the sidebar is narrow, and two columns there leave
  // ~20 characters each
  const [isSideBySide, setIsSideBySide] = useState(false);

  const url = useMemo(() => {
    const params = new URLSearchParams({
      directory: repoRoot,
      path: diff.path,
      side: diff.side,
    });
    if (diff.originalPath) params.set("originalPath", diff.originalPath);
    return `/git/diff?${params.toString()}`;
  }, [repoRoot, diff]);

  const { load } = fetcher;
  useEffect(() => {
    if (!repoRoot) return;
    load(url);
    // `refreshToken` is not used in the URL, so it has to be an explicit dep:
    // it exists purely to force this refetch
  }, [url, repoRoot, refreshToken, load]);

  const handleToggleLayout = useCallback(() => {
    setIsSideBySide((value) => !value);
  }, []);

  const language = useMemo(() => toMonacoLanguage(diff.name), [diff.name]);

  // The last diff that loaded successfully, kept so a refetch can go on
  // showing it instead of collapsing to a skeleton.
  //
  // Held separately from `fetcher.data` rather than read off it: React Router
  // revalidates every active fetcher after an action, so staging a file
  // reloads this one *and* flips its side, and `fetcher.data` is either
  // in-flight or describing the previous side for both of those loads.
  const [lastLoaded, setLastLoaded] = useState<GitDiffContent | null>(null);

  const result = fetcher.data;

  useEffect(() => {
    if (result?.ok !== true) return;
    setLastLoaded(result.diff);
  }, [result]);

  // Whether `fetcher.data` describes the file *and* side currently selected.
  // The two can disagree for a frame after a click or a stage, and rendering
  // the mismatch would label one file's contents with another's name.
  const isCurrent = useMemo(
    () =>
      result?.ok === true &&
      result.diff.path === diff.path &&
      result.diff.side === diff.side,
    [result, diff],
  );

  /**
   * What to render right now: the fresh diff when it matches the selection,
   * otherwise the previous one *for the same file*.
   *
   * Falling back only within one file is the whole point. Staging flips the
   * side, and the two sides of one file are near-identical, so keeping the old
   * content on screen across the reload reads as "nothing happened" -- which
   * is the truth. Falling back across *different* files would instead show the
   * previous file's code under the newly clicked file's name, so that case
   * still waits for its own load.
   */
  const shown = useMemo(() => {
    if (isCurrent && result?.ok === true) return result.diff;
    return lastLoaded?.path === diff.path ? lastLoaded : null;
  }, [isCurrent, result, lastLoaded, diff.path]);

  // an error replaces the content outright: a failed read must not be papered
  // over with the last good diff, which would look like it succeeded
  const error = useMemo(
    () =>
      fetcher.state === "idle" && result?.ok === false ? result.error : null,
    [fetcher.state, result],
  );

  const title = useMemo(
    () =>
      diff.originalPath
        ? `${diff.path} — renamed from ${diff.originalPath}`
        : diff.path,
    [diff],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <span
          title={title}
          className="text-muted-foreground min-w-0 flex-1 truncate px-1 font-mono text-xs"
        >
          {diff.name}
        </span>
        <span className="text-muted-foreground shrink-0 text-[10px] tracking-wide uppercase">
          {SIDE_LABEL[diff.side]}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={
                  isSideBySide ? "Show inline diff" : "Show split diff"
                }
                onClick={handleToggleLayout}
              />
            }
          >
            {isSideBySide ? <Rows2 /> : <Columns2 />}
          </TooltipTrigger>
          <TooltipContent>
            {isSideBySide ? "Inline diff" : "Split diff"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close diff"
                onClick={onClose}
              />
            }
          >
            <X />
          </TooltipTrigger>
          <TooltipContent>Close diff</TooltipContent>
        </Tooltip>
      </div>

      {/* no `overflow-auto`: Monaco scrolls itself, and an outer scroller
          would stop it from ever measuring a bounded height */}
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="text-destructive p-3 text-sm">{error}</p>
        ) : !shown ? (
          // a local git read is usually instant; delaying avoids a flash
          <DelayedRender delay={FAST_DELAY}>
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-3 w-4/5 rounded-sm" />
              <Skeleton className="h-3 w-3/5 rounded-sm" />
              <Skeleton className="h-3 w-2/3 rounded-sm" />
            </div>
          </DelayedRender>
        ) : shown.isBinary ? (
          <p className="text-muted-foreground p-3 text-sm">
            Binary file — diff not available.
          </p>
        ) : shown.isTooLarge ? (
          <p className="text-muted-foreground p-3 text-sm">
            File is too large to diff.
          </p>
        ) : (
          // never keyed or swapped out while loading: Monaco stays mounted and
          // updates its models in place, so restaging a file can't cost the
          // editor's scroll position or re-run the theme setup
          <GitDiffEditor
            language={language}
            original={shown.original}
            modified={shown.modified}
            isSideBySide={isSideBySide}
          />
        )}
      </div>
    </div>
  );
}
