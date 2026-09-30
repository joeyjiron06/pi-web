import { data, Outlet } from "react-router";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import AppSidebar from "~/components/app-sidebar";
import UpdateToast from "~/components/update-toast";
import { SidebarProvider } from "~/components/ui/sidebar";
import { useCookie } from "~/hooks/use-cookie";
import { parseSkillBlock } from "~/lib/skill-block";
import { getProjects } from "~/services/projects.server";
import {
  listLiveSessions,
  listSavedSessions,
} from "~/services/sessions.server";
import type { Route } from "./+types/default-layout";

export function loader() {
  // in-memory and synchronous, so grouping here is free. It has to happen
  // server-side: pi doesn't write a session's .jsonl until its first
  // *assistant* message lands (SessionManager._persist), so a just-created
  // session is invisible to listSavedSessions() but is already in the live
  // map -- registerLiveSession() runs before the home action redirects.
  const live = listLiveSessions();
  const liveIds = new Set(live.map((session) => session.sessionId));

  const projects = getProjects()
    .map((project) => ({
      ...project,
      // plain `===`: both sides came from prepareWorkspace()'s cwd. See
      // docs/adr/0001-paths-are-canonical-at-the-boundary.md
      sessionIds: live
        .filter((session) => session.sessionManager.getCwd() === project.path)
        .map((session) => session.sessionId),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return data({
    projects,
    // history only -- live sessions are rendered from the ids above and hydrate
    // over SSE. Deliberately not awaited: nothing on screen blocks on it, so a
    // full sessions-dir scan no longer holds up every navigation.
    savedSessions: listSavedSessions().then((all) =>
      all
        .filter((session) => !liveIds.has(session.id))
        .map((session) => ({ id: session.id, title: sessionTitle(session) })),
    ),
  });
}

/** A session read off disk, reduced to what the sidebar renders. */
export type SavedSessionInfo = { id: string; title: string };

function sessionTitle(session: SessionInfo): string {
  if (session.name) return session.name;

  const fallback = session.path.split(/[\\/]/).pop() || session.id || "";

  if (!session.firstMessage) return fallback;

  const skillBlock = parseSkillBlock(session.firstMessage);
  if (!skillBlock) return session.firstMessage;

  return skillBlock.userMessage || `/${skillBlock.name}` || fallback;
}

export default function DefaultLayout({ loaderData }: Route.ComponentProps) {
  const [sidebarOpen, setSidebarOpen] = useCookie("sidebarOpen", {
    defaultValue: true,
  });

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="w-screen max-w-screen h-screen max-h-screen overflow-x-hidden flex flex-row"
    >
      <AppSidebar
        projects={loaderData.projects}
        savedSessionsPromise={loaderData.savedSessions}
      />

      {/* renders nothing; raises a toast when a new Pi SDK is out. Mounted
          here rather than in root so it follows the sidebar's lifetime. */}
      <UpdateToast />

      {/* `min-h-0` so a route that owns its own flex column (session page:
          scrollable transcript + pinned composer) can actually constrain its
          children instead of growing past the viewport */}
      <div className="min-h-0 flex-1 overflow-x-hidden">
        <Outlet />
      </div>
    </SidebarProvider>
  );
}
