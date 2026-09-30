import { data } from "react-router";
import { findRepo } from "~/services/git.server";
import {
  RequestError,
  requireSearchParam,
  requireString,
  toErrorResponse,
  toMessage,
} from "~/services/request.server";
import type { Route } from "./+types/commit";
import type { GitActionResult } from "./git.types";

export type GitCommitResult = GitActionResult<{
  /** Whether the commit was also pushed. */
  pushed: boolean;
}>;

/** The `intent` value that asks for a push after the commit. */
const COMMIT_AND_PUSH = "commit-and-push";

/**
 * POST /git/commit?directory=<repo root>
 *   (form body: `message`, and optionally `intent=commit-and-push`)
 *
 * Commits the current index, and pushes when asked to.
 *
 * `directory` must be the repo *root*, matching the other git routes -- a
 * commit spans the whole repo, so a subdirectory would only be confusing.
 *
 * The field is named `intent` rather than `action`: a form control named
 * `action` shadows the `HTMLFormElement.action` property, which breaks any
 * caller that reads the form's URL off the element.
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    const directory = requireSearchParam(request, "directory");

    const formData = await request.formData();
    const message = requireString(
      formData,
      "message",
      "A commit message is required",
    );
    const shouldPush = formData.get("intent") === COMMIT_AND_PUSH;

    const git = await findRepo(directory);
    if (!git) {
      throw new RequestError(400, `Not a git repository: ${directory}`);
    }

    try {
      await git.commit(message);
    } catch (error) {
      throw new RequestError(400, toMessage(error, "Failed to commit"));
    }

    if (!shouldPush) {
      return data<GitCommitResult>({ ok: true, pushed: false });
    }

    try {
      await git.push();
    } catch (error) {
      // reported as a failure, but worded so it's clear the commit itself
      // landed -- retrying the whole form would otherwise commit nothing and
      // look broken
      throw new RequestError(
        400,
        `Committed, but the push failed: ${toMessage(error, "git push failed")}`,
      );
    }

    return data<GitCommitResult>({ ok: true, pushed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
