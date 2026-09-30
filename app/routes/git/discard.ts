import { data } from "react-router";
import { findRepo } from "~/services/git.server";
import {
  RequestError,
  requireSearchParam,
  requireStrings,
  toErrorResponse,
  toMessage,
} from "~/services/request.server";
import type { Route } from "./+types/discard";
import type { GitPathsResult, PathFailure } from "./git.types";

/**
 * POST /git/discard?directory=<repo root>  (form body: repeated `files` fields)
 *
 * Throws away the working-tree changes for the given repo-root-relative paths.
 *
 * **Irreversible** -- unlike `/git/stage` and `/git/unstage`, which only shuffle
 * entries between the index and the working tree, the content discarded here
 * exists nowhere in git afterwards. The caller confirms before posting.
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    const directory = requireSearchParam(request, "directory");
    const files = requireStrings(
      await request.formData(),
      "files",
      "At least one file is required",
    );

    const git = await findRepo(directory);
    if (!git) {
      throw new RequestError(400, `Not a git repository: ${directory}`);
    }

    // read the working tree once up front, because the right command differs
    // per path: a tracked file is rewritten from the index (`git restore`),
    // while an untracked one has to be deleted from disk (`git clean`) --
    // `git restore` has no version of it to restore and errors out
    const changes = await git.status();
    const untracked = new Set(
      changes
        .filter((change) => change.unstaged === "?")
        .map((change) => change.path),
    );

    // one invocation per path, and sequentially: these commands are
    // all-or-nothing per call, so a single batch would lose every good path to
    // one bad one, and concurrent calls contend on `.git/index.lock`
    const applied: string[] = [];
    const failed: PathFailure[] = [];
    for (const file of files) {
      try {
        if (untracked.has(file)) {
          await git.removeUntracked([file]);
        } else {
          await git.restoreWorktree([file]);
        }
        applied.push(file);
      } catch (error) {
        failed.push({
          path: file,
          error: toMessage(error, "git rejected the path"),
        });
      }
    }

    if (applied.length === 0) {
      throw new RequestError(
        400,
        failed[0]?.error ?? "Failed to discard the changes",
      );
    }

    return data<GitPathsResult>({ ok: true, applied, failed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
