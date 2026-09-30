import { data } from "react-router";
import { findRepo } from "~/services/git.server";
import { getSearchParam } from "~/services/request.server";
import type { Route } from "./+types/branch";

export type GitRepoInfo = {
  isGitRepo: true;

  /**
   * The resolved absolute path of the directory that was inspected.
   */
  directory: string;

  /**
   * The name of the current branch in the git repository located at the specified directory.
   * `null` when HEAD is detached (checked out to a tag or a specific commit).
   */
  branchName: string | null;

  /**
   * Local branch names. Empty for a repo that has no commits yet.
   */
  branches: string[];

  /**
   * Best guess at the repo's default branch (`origin/HEAD`, else `main`/`master`).
   */
  mainBranch: string;

  /**
   * Whether the specified directory is a linked git worktree. A worktree is a separate
   * working directory that is linked to a specific branch of a git repository.
   */
  isWorktree: boolean;
};

export type NotAGitRepo = {
  isGitRepo: false;
  directory: string;
};

export type GitBranchResult = GitRepoInfo | NotAGitRepo;

/**
 * GET /git/branch?directory=<path>
 *
 * Returns branch information for the git repo at `directory`.
 *
 * Never errors: a missing/blank param, a path that doesn't exist, a file, or a
 * directory that isn't a repo all resolve to `{ isGitRepo: false }`. Callers use
 * `fetcher.load(...)` and render conditionally instead of tripping an ErrorBoundary.
 * That is why this uses `findRepo` rather than the `require*` helpers, which throw.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const directory = getSearchParam(request, "directory");
  const git = directory ? await findRepo(directory) : null;

  if (!git) {
    return data<GitBranchResult>({
      isGitRepo: false,
      directory: directory ?? "",
    });
  }

  const [branchName, branches, mainBranch, isWorktree] = await Promise.all([
    git.getCurrentBranchName(),
    git.listBranches(),
    git.getMainBranch(),
    git.isWorktree(),
  ]);

  return data<GitBranchResult>({
    isGitRepo: true,
    // the resolved absolute path, matching what the failure branch and
    // `/git/status` report -- this used to echo the raw param instead
    directory: git.directory,
    branchName,
    branches,
    mainBranch,
    isWorktree,
  });
}
