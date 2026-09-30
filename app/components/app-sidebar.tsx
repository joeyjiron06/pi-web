import { cn } from "~/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarTrigger,
} from "./ui/sidebar";
import { Await, Link, useFetcher, useMatch } from "react-router";
import PiLogo from "~/assets/images/pi-logo";

import {
  ChevronRightIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  WrenchIcon,
  Loader2Icon,
  Maximize2Icon,
  Minimize2Icon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Button } from "./ui/button";
import { Suspense, useCallback, useEffect, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import DotsSpinner from "./dots-spinner";
import { useCookie } from "~/hooks/use-cookie";
import { toast } from "./ui/toast";
import type { RemoveProjectResult } from "~/routes/projects";
import type { Project } from "~/services/projects.server";
import type { SavedSessionInfo } from "~/layouts/default-layout";
import { useIsStreaming, useSessionTitle } from "~/store/selectors";

type Props = {
  projects: ProjectSidebarItem[];
  /**
   * Sessions read off disk. Deliberately a promise: the root loader doesn't
   * await it, so only this group suspends while the sessions dir is scanned.
   */
  savedSessionsPromise: Promise<SavedSessionInfo[]>;
};

/** A project row plus the ids of the sessions currently live in it. */
export type ProjectSidebarItem = Project & {
  sessionIds: string[];
};

export default function AppSidebar({ projects, savedSessionsPromise }: Props) {
  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="flex flex-row items-center justify-between px-4 py-3 group-data-[collapsible=icon]:px-2">
        <Link
          to="/"
          className="transition-opacity duration-200 group-data-[state=expanded]:delay-200 group-data-[collapsible=icon]:group-hover:opacity-0"
        >
          <PiLogo />
        </Link>
        <SidebarTrigger className="opacity-0 absolute right-2 transition-opacity duration-200 group-data-[collapsible=icon]:group-hover:opacity-100 group-data-[state=expanded]:opacity-100 group-data-[state=expanded]:static" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link to="/" />}
                  className="shrink-0"
                >
                  <SquarePenIcon className="size-4" />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <ProjectsSection projects={projects} />
        <SessionsSection savedSessionsPromise={savedSessionsPromise} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

// ----------- Internal components -----------

function SessionsSection({
  savedSessionsPromise,
}: {
  savedSessionsPromise: Promise<SavedSessionInfo[]>;
}) {
  const [isSessionsSectionOpen, setIsSessionsSectionOpen] = useCookie<boolean>(
    "sessionsSectionOpen",
    {
      defaultValue: true,
    },
  );

  const handleSessionsSectionToggle = useCallback(
    (open: boolean) => {
      setIsSessionsSectionOpen(open);
    },
    [setIsSessionsSectionOpen],
  );

  return (
    <Collapsible
      open={isSessionsSectionOpen}
      onOpenChange={handleSessionsSectionToggle}
      className="group/sessions"
    >
      <SidebarGroup className="group-data-[collapsible=icon]:hidden pb-0">
        <div className="group/sessions-label relative w-full">
          <SidebarGroupLabel className="w-full justify-between gap-2">
            <CollapsibleTrigger className="flex items-center justify-start gap-2 flex-1 group/sessions-trigger h-full">
              Sessions
              <ChevronRightIcon className="size-3 opacity-0 transition-all group-data-open/sessions:rotate-90 group-hover/sessions-trigger:opacity-100" />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
        </div>

        <CollapsibleContent>
          <Suspense
            fallback={
              <>
                <SidebarMenuSkeleton />
                <SidebarMenuSkeleton />
                <SidebarMenuSkeleton />
              </>
            }
          >
            <Await
              resolve={savedSessionsPromise}
              errorElement={
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Couldn't load sessions
                </div>
              }
            >
              {(savedSessions) =>
                savedSessions.map((session) => (
                  <SessionMenuItem
                    key={session.id}
                    sessionId={session.id}
                    title={session.title}
                    isLive={false}
                  />
                ))
              }
            </Await>
          </Suspense>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function ProjectsSection({ projects }: { projects: ProjectSidebarItem[] }) {
  const [isProjectSectionOpen, setIsProjectSectionOpen] = useCookie<boolean>(
    "projectsSectionOpen",
    {
      defaultValue: true,
    },
  );
  const [projectGroupOpenSet, setProjectGroupOpenSet] = useCookie<string[]>(
    "projectGroupOpenList",
    {
      defaultValue: projects.map((p) => p.path),
    },
  );

  const handleProjectSectionToggle = useCallback(
    (project: ProjectSidebarItem) => (open: boolean) => {
      setProjectGroupOpenSet((prev) => {
        if (open) {
          return [...prev, project.path];
        } else {
          return prev.filter((p) => p !== project.path);
        }
      });
    },
    [setProjectGroupOpenSet],
  );

  const handleProjectRemoved = useCallback(
    (projectPath: string) => {
      // the open/closed cookie would otherwise keep growing with paths that no
      // longer exist
      setProjectGroupOpenSet((prev) => prev.filter((p) => p !== projectPath));
    },
    [setProjectGroupOpenSet],
  );

  const handleAllProjectsToggle = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const allOpen = projects.every((p) =>
        projectGroupOpenSet.includes(p.path),
      );
      if (allOpen) {
        setProjectGroupOpenSet([]);
      } else {
        setProjectGroupOpenSet(projects.map((p) => p.path));
      }
    },
    [setProjectGroupOpenSet, projects],
  );

  const allProjectsOpen = useMemo(
    () =>
      projects.every((project) => projectGroupOpenSet.includes(project.path)),
    [projects, projectGroupOpenSet],
  );

  const handleProjectSectionOpenChange = useCallback(
    (open: boolean) => {
      setIsProjectSectionOpen(open);
    },
    [setIsProjectSectionOpen],
  );

  return (
    <Collapsible
      open={isProjectSectionOpen}
      onOpenChange={handleProjectSectionOpenChange}
      className="group/projects"
    >
      <SidebarGroup className="group-data-[collapsible=icon]:hidden pb-0">
        <div className="group/projects-label relative w-full">
          <SidebarGroupLabel className="w-full justify-between gap-2">
            <CollapsibleTrigger className="flex items-center justify-start gap-2 flex-1 group/projects-trigger h-full">
              Projects
              <ChevronRightIcon className="size-3 opacity-0 transition-all group-data-open/projects:rotate-90 group-hover/projects-trigger:opacity-100" />
            </CollapsibleTrigger>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleAllProjectsToggle}
              className="pointer-events-none z-10 opacity-0 transition-opacity group-hover/projects-label:pointer-events-auto group-hover/projects-label:opacity-100"
            >
              {allProjectsOpen ? (
                <Minimize2Icon className="size-3" />
              ) : (
                <Maximize2Icon className="size-3" />
              )}
            </Button>
          </SidebarGroupLabel>
        </div>

        <CollapsibleContent>
          {projects.map((project) => (
            <ProjectGroup
              key={project.path}
              project={project}
              open={projectGroupOpenSet.includes(project.path)}
              onOpenChange={handleProjectSectionToggle(project)}
              onRemoved={handleProjectRemoved}
            />
          ))}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function ProjectGroup({
  project,
  open,
  onOpenChange,
  onRemoved,
}: {
  project: ProjectSidebarItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: (projectPath: string) => void;
}) {
  const deleteFetcher = useFetcher<RemoveProjectResult>();
  const isDeleting = deleteFetcher.state !== "idle";
  const deleteResult = deleteFetcher.data;

  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      const formData = new FormData();
      formData.set("path", project.path);
      deleteFetcher.submit(formData, {
        method: "delete",
        action: "/projects",
      });
      // done optimistically rather than on success: a successful delete drops
      // this project from the root loader data, so the component unmounts
      // before any "it worked" effect could run. Worst case on failure is a
      // collapsed group.
      onRemoved(project.path);
    },
    [deleteFetcher, project.path, onRemoved],
  );

  const handleActionClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  const handleToggle = useCallback(() => {
    onOpenChange(!open);
  }, [onOpenChange, open]);

  useEffect(() => {
    // keyed off the result object, not the message: retrying and failing the
    // same way should toast again
    if (!deleteResult || deleteResult.ok) return;
    toast.add({
      title: "Couldn't remove project",
      description: deleteResult.error,
      type: "error",
    });
  }, [deleteResult]);

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="group/collapsible group-data-[collapsible=icon]:hidden"
    >
      <SidebarGroup className={cn("p-0", isDeleting && "pointer-events-none opacity-50")}>
        <SidebarGroupLabel className="group/label p-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleToggle}>
                <span className="flex items-center gap-2 mr-3.5">
                  {open ? (
                    <FolderOpenIcon className="size-3" />
                  ) : (
                    <FolderClosedIcon className="size-3" />
                  )}
                  <span className="truncate flex-1" title={project.path}>
                    {project.name}
                  </span>

                  <ChevronRightIcon className="ml-auto size-3! transition-all group-data-open/collapsible:rotate-90 opacity-0 group-hover/label:opacity-100" />
                </span>
              </SidebarMenuButton>
              <DropdownMenu>
                <SidebarMenuAction
                  // `showOnHover` hides the action at opacity-0 unless the row
                  // is hovered -- the menu closes on Remove, so the spinner
                  // would be invisible the moment the pointer leaves
                  showOnHover={!isDeleting}
                  disabled={isDeleting}
                  className="right-7"
                  render={<DropdownMenuTrigger />}
                  onClick={handleActionClick}
                >
                  {isDeleting ? (
                    <Loader2Icon className="size-3! animate-spin" />
                  ) : (
                    <MoreHorizontalIcon className="size-3!" />
                  )}
                </SidebarMenuAction>
                <DropdownMenuPortal>
                  <DropdownMenuContent
                    align="end"
                    side="bottom"
                    className="text-base min-w-40"
                  >
                    <DropdownMenuItem
                      variant="destructive"
                      className="px-2 py-1.5 gap-2"
                      onClick={handleDelete}
                    >
                      <XIcon className="size-4" />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
              <SidebarMenuAction
                showOnHover
                render={
                  <Link to={`/?cwd=${encodeURIComponent(project.path)}`} />
                }
                onClick={handleActionClick}
              >
                <SquarePenIcon className="size-3!" />
              </SidebarMenuAction>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {project.sessionIds.length > 0 ? (
                project.sessionIds.map((sessionId) => (
                  <LiveSessionMenuItem
                    key={sessionId}
                    sessionId={sessionId}
                    className="pl-6"
                  />
                ))
              ) : (
                <SidebarMenuItem>
                  <div className="px-2 py-1.5 pl-6 text-xs text-muted-foreground">
                    No chats
                  </div>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

/**
 * A session that's live on the server. The root loader hands us the id; the
 * title and streaming state come over SSE, so both can be a beat behind on a
 * cold load -- hence the skeleton.
 */
function LiveSessionMenuItem({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const title = useSessionTitle(sessionId);

  if (!title) {
    return <SidebarMenuSkeleton className={className} />;
  }

  return (
    <SessionMenuItem
      sessionId={sessionId}
      title={title}
      isLive
      className={className}
    />
  );
}

function SessionMenuItem({
  sessionId,
  title,
  isLive,
  className,
}: {
  sessionId: string;
  title: string;
  isLive: boolean;
  className?: string;
}) {
  const match = useMatch(`/session/:sessionId`);
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const isDeleting = deleteFetcher.state !== "idle";
  const isActive = match?.params.sessionId === sessionId;
  // subscribed per row so a streaming turn re-renders one menu item rather than
  // the whole sidebar
  const isStreaming = useIsStreaming(sessionId);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className={className}
        isActive={isActive}
        render={<Link to={`/session/${sessionId}`} />}
        title={title}
      >
        <span className="truncate">{title}</span>
      </SidebarMenuButton>

      {isStreaming && (
        <div className="pointer-events-none absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center opacity-100 transition-opacity group-hover/menu-item:opacity-0">
          <DotsSpinner className="size-3! text-muted-foreground" />
        </div>
      )}

      {isLive && (
        <deleteFetcher.Form method="post" action={`/session/${sessionId}`}>
          <input type="hidden" name="intent" value="close" />
          {isActive && <input type="hidden" name="redirectTo" value="/" />}
          <SidebarMenuAction type="submit" disabled={isDeleting} showOnHover>
            {isDeleting ? (
              <Loader2Icon className="size-3! animate-spin" />
            ) : (
              <Trash2Icon className="size-3!" />
            )}
          </SidebarMenuAction>
        </deleteFetcher.Form>
      )}
    </SidebarMenuItem>
  );
}
