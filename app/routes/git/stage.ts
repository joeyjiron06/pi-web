import { data } from "react-router";
import { findRepo } from "~/services/git.server";
import {
  RequestError,
  requireSearchParam,
  requireStrings,
  toErrorResponse,
  toMessage,
} from "~/services/request.server";
import type { Route } from "./+types/stage";
import type { GitPathsResult, PathFailure } from "./git.types";

/**
 * POST /git/stage?directory=<repo root>  (form body: repeated `files` fields)
 *
 * Stages the given repo-root-relative paths.
 *
 * `directory` must be the repo *root*: `git status` reports every path relative
 * to the root, so a subdirectory would resolve the posted paths against the
 * wrong base and stage the wrong files.
 *
 * Unlike `/git/status` and `/git/branch`, this route reports failures instead
 * of degrading to `{ isGitRepo: false }`: a mutation that silently does nothing
 * is worse than one that says so.
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

    // one invocation per path, and sequentially: `git add` is all-or-nothing
    // per call, so a single batch would lose every good path to one bad one,
    // and concurrent calls contend on `.git/index.lock` and fail spuriously
    const applied: string[] = [];
    const failed: PathFailure[] = [];
    for (const file of files) {
      try {
        await git.stage([file]);
        applied.push(file);
      } catch (error) {
        failed.push({
          path: file,
          error: toMessage(error, "git rejected the path"),
        });
      }
    }

    // nothing landed: report one error rather than a "succeeded, but..." that
    // lists every path the caller asked for. A rejected pathspec is the
    // caller's mistake, so 400 rather than 500.
    if (applied.length === 0) {
      throw new RequestError(
        400,
        failed[0]?.error ?? "Failed to stage the files",
      );
    }

    return data<GitPathsResult>({ ok: true, applied, failed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
