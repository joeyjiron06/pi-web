import { data } from "react-router";
import { findRepo } from "~/services/git.server";
import {
  RequestError,
  requireSearchParam,
  requireStrings,
  toErrorResponse,
  toMessage,
} from "~/services/request.server";
import type { Route } from "./+types/unstage";
import type { GitPathsResult, PathFailure } from "./git.types";

/**
 * POST /git/unstage?directory=<repo root>  (form body: repeated `files` fields)
 *
 * Removes the given repo-root-relative paths from the index. The working tree
 * is never touched: a staged new file returns to untracked, an edit to
 * unstaged, and nothing is lost from disk.
 *
 * Mirrors `/git/stage`, including its per-path error reporting.
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

    // one invocation per path, and sequentially: `git restore --staged` is
    // all-or-nothing per call, so a single batch would lose every good path to
    // one bad one, and concurrent calls contend on `.git/index.lock`
    const applied: string[] = [];
    const failed: PathFailure[] = [];
    for (const file of files) {
      try {
        await git.unstage([file]);
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
        failed[0]?.error ?? "Failed to unstage the files",
      );
    }

    return data<GitPathsResult>({ ok: true, applied, failed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
