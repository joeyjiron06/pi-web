import { createContext, useContext } from "react";
import type { GitDiffSide } from "~/services/git.server";

/**
 * The file whose diff is open in the changes panel.
 *
 * Carries `side` because the same path can appear in both the staged and the
 * unstaged section (`AM`), and the two show *different* diffs -- the section a
 * row lives in is the only thing that says which one was clicked.
 */
export type ActiveDiff = {
  /** repo-root-relative path */
  path: string;
  /** pre-rename path, or null */
  originalPath: string | null;
  side: GitDiffSide;
  /** trailing segment, for the viewer header */
  name: string;
};

/**
 * Shared selection state for the git changes panel.
 *
 * Context rather than props for the same reason the file explorer uses one:
 * the tree is arbitrarily deep, the row that selects is at any depth, and
 * every row needs to know whether it is the selected one.
 */
export type GitChangesContextValue = {
  activeDiff: ActiveDiff | null;
  selectDiff: (diff: ActiveDiff) => void;
  clearDiff: () => void;
};

const GitChangesContext = createContext<GitChangesContextValue>({
  activeDiff: null,
  selectDiff: () => {},
  clearDiff: () => {},
});

export const GitChangesProvider = GitChangesContext.Provider;

export function useGitChanges(): GitChangesContextValue {
  return useContext(GitChangesContext);
}

/** Whether `diff` is the same selection as `candidate`. */
export function isSameDiff(
  a: ActiveDiff | null,
  b: Pick<ActiveDiff, "path" | "side">,
): boolean {
  return a?.path === b.path && a?.side === b.side;
}
