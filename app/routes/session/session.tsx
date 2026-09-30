import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { PanelRight } from "lucide-react";
import { Activity, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { data, Form, redirect, useNavigation } from "react-router";
import ChatMessageList, {
  ChatMessagesSkeleton,
} from "~/components/chat-message-list";
import ContextUsage from "~/components/context-usage";
import DotsSpinner from "~/components/dots-spinner";
import PromptInput from "~/components/prompt-input";
import QueuedMessages from "~/components/queued-messages";
import SessionSidebar from "~/components/session-sidebar";
import { Button } from "~/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { toast } from "~/components/ui/toast";
import { FileDropOverlay } from "~/components/file-drop-overlay";
import { useAttachments } from "~/hooks/use-attachments";
import { useFileDrop } from "~/hooks/use-file-drop";
import { ATTACHMENT_FIELD_NAME } from "~/lib/attachments";
import { parseModelRef, toModelRef } from "~/lib/model-ref";
import { getModelDefaults, getModels } from "~/services/models.server";
import { prepareAttachments } from "~/services/attachments.server";
import {
  abortSession,
  clearSessionQueue,
  getLiveSession,
  loadSession,
  resumeSession,
  sessionPrompt,
  sessionStateFromAgentSession,
  stopSession,
  updateSessionModel,
  updateSessionThinkingLevel,
  type SessionSnapshot,
} from "~/services/sessions.server";
import { useIsSidebarOpen, useIsStreaming, useSelector } from "~/store/selectors";
import { store } from "~/store/store";
import type { Route } from "./+types/session";
import { sessionPromptSchema, type SessionPromptResult } from "./session.types";
import { THINKING_LEVELS } from "~/routes/home/home.types";
import { z } from "zod";
import { Badge } from "~/components/ui/badge";
import { useAwait } from "~/hooks/use-await";

export function loader({ params }: Route.LoaderArgs) {
  const { sessionId } = params;
  const liveSession = getLiveSession(sessionId);
  const modelDefaults = getModelDefaults();

  // Live sessions are already in memory on the client since they are being
  // actively updated by server sent events. For non-live sessions the user
  // clicks on, we read the snapshot off disk and hand it to the client.
  const session = liveSession
    ? undefined
    : loadSession(sessionId).then(sessionStateFromAgentSession);

  return data({
    session,
    // awaited plain values: they seed useState on the first render, so unlike
    // `models` they can't be streamed in later. They're only a starting point --
    // an effect re-syncs them to the session's real model/thinking level.
    defaultModelRef: modelDefaults.modelRef ?? "",
    defaultThinkingLevel: modelDefaults.thinkingLevel ?? "medium",
    // deliberately not awaited -- streamed in, only suspends the pickers
    models: getModels(),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const parsed = sessionPromptSchema.safeParse(await request.formData());

  if (!parsed.success) {
    const flattened = z.flattenError(parsed.error);
    return data<SessionPromptResult>(
      {
        ok: false,
        formErrors: flattened.formErrors,
        fieldErrors: flattened.fieldErrors as Record<string, string[]>,
      },
      { status: 400 },
    );
  }

  const { sessionId } = params;

  if (parsed.data.intent === "abort") {
    // a no-op if the session isn't live or isn't streaming, so a double click
    // (or a stale button) can't fail. Clears the queue as well as aborting --
    // see abortSession for why the order matters.
    const restored = await abortSession(sessionId);
    return data<SessionPromptResult>({ ok: true, restored });
  }

  // Above resumeSession on purpose: clearing a queue must never promote a
  // session that isn't live. A session that isn't live has no queue anyway.
  if (parsed.data.intent === "clear-queue") {
    const restored = clearSessionQueue(sessionId);
    return data<SessionPromptResult>({ ok: true, restored });
  }

  if (parsed.data.intent === "close") {
    // idempotent: a no-op if the session isn't live, so a double click is safe
    await stopSession(sessionId);

    // only sent when closing the session that's currently on screen -- this
    // route's loader would otherwise re-read a session that was just disposed
    if (parsed.data.redirectTo) {
      throw redirect(parsed.data.redirectTo);
    }

    return data<SessionPromptResult>({ ok: true });
  }

  // no-op when already live; otherwise promotes the session read off disk
  const session = await resumeSession(sessionId);

  // the schema already rejected a malformed ref, so this can't be null
  const modelRef = parseModelRef(parsed.data.modelRef!)!;
  const submittedModelRef = parsed.data.modelRef!;

  try {
    // applied here, and only here: the pickers never call an API of their own,
    // so the model can't change out from under a turn that's already running.
    // awaited (not fire-and-forget) so the prompt can't go out on the old model.
    if (!session.model || toModelRef(session.model) !== submittedModelRef) {
      await updateSessionModel(sessionId, modelRef);
    }
  } catch (error) {
    return data<SessionPromptResult>(
      {
        ok: false,
        formErrors: [
          error instanceof Error ? error.message : "Couldn't switch model",
        ],
        fieldErrors: {},
      },
      { status: 400 },
    );
  }

  if (session.thinkingLevel !== parsed.data.thinkingLevel) {
    updateSessionThinkingLevel(sessionId, parsed.data.thinkingLevel!);
  }

  // Awaited, unlike the prompt below: resizing has to finish before the images
  // can be attached, and a failure here is worth reporting to the user rather
  // than silently sending a prompt that refers to a missing screenshot.
  const prepared = await prepareAttachments(
    parsed.data[ATTACHMENT_FIELD_NAME],
    sessionId,
  );

  if (prepared.errors.length > 0 && prepared.images.length === 0) {
    // Nothing usable survived, so don't send a prompt that talks about an
    // attachment the agent will never see.
    return data<SessionPromptResult>(
      { ok: false, formErrors: prepared.errors, fieldErrors: {} },
      { status: 400 },
    );
  }

  const promptText = prepared.fileReferencesText
    ? `${parsed.data.prompt!}\n\n${prepared.fileReferencesText}`
    : parsed.data.prompt!;

  // Not awaited to completion: `sessionPrompt` resolves as soon as pi accepts
  // or rejects the prompt, not when the turn ends (which can take minutes). The
  // transcript itself is driven by SSE.
  //
  // `streamingBehavior` is passed unconditionally: pi ignores it when not
  // streaming, and reading `session.isStreaming` here to decide would be a
  // TOCTOU race against the agent loop.
  const outcome = await sessionPrompt(sessionId, promptText, {
    images: prepared.images,
    streamingBehavior: parsed.data.deliverAs,
  });

  // Rejections before acceptance (compaction in progress, a model with no
  // auth, an extension refusing the input) never reach the event stream, so
  // without this the send silently does nothing.
  if (!outcome.accepted) {
    return data<SessionPromptResult>(
      { ok: false, formErrors: [outcome.error], fieldErrors: {} },
      { status: 400 },
    );
  }

  return data<SessionPromptResult>({ ok: true });
}

export default function SessionRoute({
  params,
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    // owns its own height so the transcript scrolls and the composer stays put
    <div className="h-full min-h-0">
      <SessionPage
        // remount on session change: every piece of state below (draft prompt,
        // model, thinking level) belongs to one session
        key={params.sessionId}
        sessionId={params.sessionId}
        sessionSnapshot={loaderData.session}
        models={loaderData.models}
        defaultModelRef={loaderData.defaultModelRef}
        defaultThinkingLevel={loaderData.defaultThinkingLevel}
        actionData={actionData}
      />
    </div>
  );
}

function SessionPage({
  sessionId,
  sessionSnapshot,
  models,
  defaultModelRef,
  defaultThinkingLevel,
  actionData,
}: {
  sessionId: string;
  sessionSnapshot?: Promise<SessionSnapshot>;
  models: Promise<Model<Api>[]>;
  defaultModelRef: string;
  defaultThinkingLevel: ThinkingLevel;
  actionData?: SessionPromptResult;
}) {
  const liveSession = useSelector((state) => state.sessions[sessionId]);

  const handleSnapshotLoaded = useCallback((snapshot: SessionSnapshot) => {
    // dispatched into the store so the rest of the app reads a loaded session
    // exactly the same way it reads a live one
    store.dispatch({ type: "session_created", payload: snapshot });
  }, []);

  const handleSnapshotFailed = useCallback((error: Error) => {
    toast.add({
      title: "Couldn't load session",
      description: error.message,
      type: "error",
      timeout: 0,
    });
  }, []);

  const [loadedSession] = useAwait(sessionSnapshot, {
    onFulfilled: handleSnapshotLoaded,
    onRejected: handleSnapshotFailed,
  });

  // non-fatal on rejection: a session that failed to load shouldn't also blow
  // up as an unhandled rejection
  const session = liveSession || loadedSession;

  // the `@` file search and `/` skill list run against the session's own dir.
  // Empty until the snapshot lands (cold load of a non-live session), which the
  // input treats as "skip the lookups" rather than erroring.
  const cwd = useMemo(() => session?.cwd ?? "", [session?.cwd]);

  const [userPrompt, setUserPrompt] = useState("");
  const [modelRef, setModelRef] = useState(defaultModelRef);
  const [thinkingLevel, setThinkingLevel] =
    useState<ThinkingLevel>(defaultThinkingLevel);

  // derive the *string* ref: session.model is a fresh object on every snapshot,
  // so keying the effect on the object would refire on unrelated updates and
  // stomp a selection the user hasn't submitted yet
  const sessionModelRef = useMemo(
    () => (session?.model ? toModelRef(session.model) : ""),
    [session?.model],
  );

  useEffect(() => {
    if (sessionModelRef) setModelRef(sessionModelRef);
  }, [sessionModelRef]);

  // this is also what makes pi's thinking-level *clamping* visible: the picker
  // snaps to the level the agent actually accepted.
  // pi's own type also allows "off", which this UI has no control for, so an
  // "off" session is left showing the default rather than crashing the picker.
  const sessionThinkingLevel = useMemo(
    () => THINKING_LEVELS.find((level) => level === session?.thinkingLevel),
    [session?.thinkingLevel],
  );

  useEffect(() => {
    if (sessionThinkingLevel) setThinkingLevel(sessionThinkingLevel);
  }, [sessionThinkingLevel]);

  const navigation = useNavigation();
  const isBusy = navigation.state !== "idle";
  const isStreaming = useIsStreaming(sessionId);

  const { attachments, addFiles, removeAttachment, clearAttachments } =
    useAttachments();
  const isDragging = useFileDrop(addFiles);

  // nothing revalidates on submit, so the textarea has to be cleared by hand.
  // aborts leave the draft alone -- the user didn't send it.
  useEffect(() => {
    if (
      navigation.state === "submitting" &&
      navigation.formData?.get("intent") !== "abort"
    ) {
      setUserPrompt("");
      // by now React Router has already snapshotted the FormData, so clearing
      // the staged files here can't race the upload
      clearAttachments();
    }
  }, [navigation.state, navigation.formData, clearAttachments]);

  /**
   * Put messages an abort or a queue clear pulled out of the queue back into
   * the composer, so neither one destroys text the user typed.
   */
  const restoreToComposer = useCallback((messages: string[]) => {
    const restored = messages.join("\n\n");
    setUserPrompt((draft) =>
      [restored, draft].filter((part) => part.trim()).join("\n\n"),
    );
  }, []);

  /**
   * The abort path, which comes back through the page's own action result.
   * Queue clears go through a fetcher and are handled inside QueuedMessages.
   *
   * The ref guard matters: `actionData` sticks around across unrelated
   * re-renders, so without it every render would prepend the same text again.
   * Comparing object *identity* rather than contents is what makes one action
   * result apply exactly once.
   */
  const appliedRestoreRef = useRef<unknown>(null);

  useEffect(() => {
    if (!actionData?.ok || !actionData.restored?.length) return;
    if (appliedRestoreRef.current === actionData) return;

    appliedRestoreRef.current = actionData;
    restoreToComposer(actionData.restored);
  }, [actionData, restoreToComposer]);

  useEffect(() => {
    if (!actionData || actionData.ok) return;

    const messages = [
      ...actionData.formErrors,
      ...Object.values(actionData.fieldErrors).flat(),
    ];

    for (const message of messages) {
      toast.add({
        title: "Couldn't send",
        description: message,
        type: "error",
        timeout: 0,
      });
    }
  }, [actionData]);

  const handlePromptChanged = useCallback((text: string) => {
    setUserPrompt(text);
  }, []);

  const isSidebarOpen = useIsSidebarOpen(sessionId);

  const handleToggleSidebar = useCallback(() => {
    store.dispatch({ type: "sidebar_toggled", payload: { sessionId } });
  }, [sessionId]);

  return (
    <>
      <FileDropOverlay isDragging={isDragging} />

      {/* Fixed to the viewport, not to a panel: it sits above everything
          (including the sidebar panel it toggles) and never shifts when either
          sidebar opens, closes, or is resized. z-[100] clears the z-50 used by
          dialogs, sheets and menus. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-expanded={isSidebarOpen}
              aria-label={isSidebarOpen ? "Hide details" : "Show details"}
              onClick={handleToggleSidebar}
              className="bg-background/80 fixed top-2 right-2 z-[100] backdrop-blur"
            />
          }
        >
          <PanelRight />
        </TooltipTrigger>
        <TooltipContent>
          {isSidebarOpen ? "Hide details" : "Show details"}
        </TooltipContent>
      </Tooltip>

      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel
          // Units matter: `defaultSize` is written straight into CSS as
          // `flex-basis` on the first render (before the group registers and
          // takes over sizing). "70" is not a valid CSS length, so the browser
          // drops it and the panel falls back to `flex: 0 1 auto` -- i.e. sized
          // to its content. "70%" is both valid CSS and a valid library size.
          //
          // The value is conditional because a hidden <Activity> unmounts its
          // children's effects, so the sidebar panel deregisters and this becomes
          // the group's only panel while closed.
          defaultSize={isSidebarOpen ? "70%" : "100%"}
          minSize="35%"
          className="flex min-h-0 flex-col"
        >
          <div className="min-h-0 flex-1">
            {session ? (
              <ChatMessageList sessionId={sessionId} />
            ) : (
              <ChatMessagesSkeleton />
            )}
          </div>

          <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 flex flex-col gap-2">
            {/* Above the status row, not between it and the composer: this
                container is anchored to the bottom of the panel, so anything
                inserted below the row pushes the row away from the composer as
                the queue grows. Sitting on top, the queue expands upward into
                the transcript instead and neither the badge, the context usage
                nor the composer moves. */}
            <QueuedMessages sessionId={sessionId} onRestore={restoreToComposer} />

            {/* min-h keeps the row from collapsing (and shifting the composer) when
                the streaming badge comes and goes. The badge gets ml-auto rather
                than the row getting justify-between: with the badge absent the
                ring must still sit on the left. */}
            <div className="flex min-h-6 items-center gap-2 justify-between">
              <div>
                {isStreaming && (
                  <Badge
                    variant="secondary"
                    className="ml-auto text-xs flex items-center gap-1.5 pr-1 pl-0"
                  >
                    <DotsSpinner />
                    working…
                  </Badge>
                )}
              </div>

              <ContextUsage sessionId={sessionId} />
            </div>

            {/* defaultShouldRevalidate={false}: this route's loader re-reads the
                session off disk (and the root loader rescans the sessions dir).
                None of that is needed -- the transcript is driven by SSE. */}
            <Form
              method="post"
              defaultShouldRevalidate={false}
              encType="multipart/form-data"
            >
              {/* a disabled fieldset natively disables every control inside it, so
                  the composer stays mounted (and sized) while the snapshot loads
                  without being usable */}
              <fieldset disabled={!session}>
                <PromptInput
                  text={userPrompt}
                  onTextChanged={handlePromptChanged}
                  modelRef={modelRef}
                  modelsPromise={models}
                  onModelChanged={setModelRef}
                  thinkingLevel={thinkingLevel}
                  thinkingLevelChanged={setThinkingLevel}
                  cwd={cwd}
                  isBusy={isBusy}
                  isStreaming={isStreaming}
                  attachments={attachments}
                  onAttachmentRemove={removeAttachment}
                  onFilesSelected={addFiles}
                />
              </fieldset>
            </Form>
          </div>
        </ResizablePanel>

        {/* <Activity mode="hidden"> keeps this subtree's DOM and React state
            alive across toggles while React applies `display: none` -- so it
            takes up no space in the group and drops out of the accessibility
            tree and the tab order. Hidden Activity also unmounts effects, so the
            panel and separator deregister from the group while closed. */}
        <Activity mode={isSidebarOpen ? "visible" : "hidden"}>
          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="30%" minSize="20%">
            <SessionSidebar cwd={cwd} />
          </ResizablePanel>
        </Activity>
      </ResizablePanelGroup>
    </>
  );
}
