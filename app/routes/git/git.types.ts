/**
 * Response shapes shared by the git routes.
 *
 * Lives here rather than in a `.server.ts` module so components can import it
 * without pulling a server-only file into the client graph, matching
 * `fs.types.ts`, `home.types.ts` and `session.types.ts`.
 */

import type { GitDiffContent } from "~/services/git.server";

/** A path git refused, with its own reason. */
export type PathFailure = {
  path: string;
  error: string;
};

/**
 * The envelope every git *action* route returns. `T` is the success payload
 * only -- the failure arm is identical everywhere, so it is written once.
 */
export type GitActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * The shape shared by `/git/stage`, `/git/unstage` and `/git/discard`.
 *
 * Deliberately one type rather than three: these routes used to rename the
 * applied list to `staged`/`unstaged`/`discarded`, which told the caller
 * nothing it didn't already know -- it picked the route -- while forcing
 * `git-file-tree.tsx` to sniff properties at runtime to count them.
 */
/**
 * What `/git/diff` returns. The payload is the service type verbatim -- a
 * `import type` is erased at build time, so this does not pull `git.server.ts`
 * into the client bundle.
 */
export type GitDiffResult = GitActionResult<{ diff: GitDiffContent }>;

export type GitPathsResult = GitActionResult<{
  /** Paths the command succeeded on. */
  applied: string[];
  /** Paths git rejected. Empty on a fully successful run. */
  failed: PathFailure[];
}>;
