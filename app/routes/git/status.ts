import { data } from "react-router";
import type { GitChangeGroups } from "~/services/git.server";
import { createGitCli, groupGitChanges } from "~/services/git.server";
import { getSearchParam } from "~/services/request.server";
import type { Route } from "./+types/status";

export type GitStatusResult =
  | ({
      isGitRepo: true;

      /** The resolved absolute path that was inspected. */
      directory: string;

      /**
       * Absolute path of the repo root. Every path in the trees is relative to
       * this, not to `directory`.
       */
      repoRoot: string;
    } & GitChangeGroups)
  | { isGitRepo: false; directory: string };

/**
 * GET /git/status?directory=<path>
 *
 * Returns the working tree status of the repo containing `directory`.
 *
 * Mirrors `/git/branch`: never errors. A missing param, a nonexistent path, or
 * a directory outside a repo all resolve to `{ isGitRepo: false }` so callers
 * can render conditionally instead of tripping an ErrorBoundary. That is why
 * this uses `getSearchParam` rather than the `require*` helpers, which throw.
 *
 * The only git route that doesn't go through `findRepo`: it needs the repo
 * root, not just a yes/no, and `getRepoRoot()` answers both in one `git`
 * process. Routing it through `findRepo` first would spawn a second one.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const directory = getSearchParam(request, "directory");

  if (!directory) {
    return data<GitStatusResult>({ isGitRepo: false, directory: "" });
  }

  const git = createGitCli(directory);

  // resolving the root doubles as the repo check: it fails for nonexistent
  // paths and for directories outside any repo
  const repoRoot = await git.getRepoRoot();
  if (!repoRoot) {
    return data<GitStatusResult>({ isGitRepo: false, directory: git.directory });
  }

  return data<GitStatusResult>({
    isGitRepo: true,
    directory: git.directory,
    repoRoot,
    // grouped and built here rather than in the component: the tree builder
    // lives in git.server.ts, which is stripped from the client bundle
    ...groupGitChanges(await git.status()),
  });
}
