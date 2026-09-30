import { data } from "react-router";
import { removeProject } from "~/services/projects.server";
import { stopSessionsForCwd } from "~/services/sessions.server";
import type { Route } from "./+types/projects";

export type RemoveProjectResult =
  | { ok: true; stoppedSessionIds: string[] }
  | { ok: false; error: string };

/**
 * DELETE /projects  (body: `path=<project path>`)
 *
 * Removes a project from the recents list and stops every live session running
 * in it. The project row is the only entry point to those sessions in the
 * sidebar, so they'd be unreachable-but-running otherwise.
 *
 * Nothing is deleted from disk: neither the project folder nor the session
 * transcripts (they stay reachable under "Sessions").
 *
 * React Router dispatches every non-GET verb to the same `action`, so the
 * method has to be checked by hand.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "DELETE") {
    return data<RemoveProjectResult>(
      { ok: false, error: `Method ${request.method} not allowed` },
      { status: 405 },
    );
  }

  const formData = await request.formData();
  const projectPath = String(formData.get("path") ?? "").trim();

  if (!projectPath) {
    return data<RemoveProjectResult>(
      { ok: false, error: "A project path is required" },
      { status: 400 },
    );
  }

  try {
    // sessions first: if this throws, the project stays in the list and the
    // user can retry, rather than losing the row while its sessions live on
    const stoppedSessionIds = await stopSessionsForCwd(projectPath);
    removeProject(projectPath);

    return data<RemoveProjectResult>({ ok: true, stoppedSessionIds });
  } catch (error) {
    return data<RemoveProjectResult>(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to remove project",
      },
      { status: 500 },
    );
  }
}
