import { data } from "react-router";
import type { GitDiffSide } from "~/services/git.server";
import { findRepo } from "~/services/git.server";
import {
  RequestError,
  getSearchParam,
  requireSearchParam,
  toErrorResponse,
} from "~/services/request.server";
import type { Route } from "./+types/diff";
import type { GitDiffResult } from "./git.types";

/** The only two values `side` may take; anything else is a caller bug. */
const SIDES: readonly string[] = ["staged", "unstaged"];

/**
 * GET /git/diff?directory=<repo root>&path=<repo-relative path>&side=staged|unstaged
 *   [&originalPath=<pre-rename path>]
 *
 * The before/after contents of one changed file, for the diff viewer.
 *
 * `directory` must be the repo *root*, for the same reason the mutation routes
 * require it: every path in the status tree is reported relative to the root.
 *
 * Unlike `/git/status` this reports errors rather than degrading to an empty
 * state -- the panel only ever calls it for a file the user explicitly clicked,
 * so an empty result would look like "this file has no changes", which is a lie.
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const directory = requireSearchParam(request, "directory");
    const path = requireSearchParam(request, "path");
    const side = requireSearchParam(request, "side");
    // absent for everything except renames and copies
    const originalPath = getSearchParam(request, "originalPath");

    if (!SIDES.includes(side)) {
      throw new RequestError(400, `Unknown diff side: ${side}`);
    }

    const git = await findRepo(directory);
    if (!git) {
      throw new RequestError(400, `Not a git repository: ${directory}`);
    }

    const diff = await git.diff({
      path,
      originalPath,
      side: side as GitDiffSide,
    });

    return data<GitDiffResult>({ ok: true, diff });
  } catch (error) {
    return toErrorResponse(error);
  }
}
