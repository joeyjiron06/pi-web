import type { ApplicationState } from "./types";
import { thinkingContentId } from "./types";
import { useMemo, useSyncExternalStore } from "react";
import { store } from "./store";
import { parseSkillBlock } from "~/lib/skill-block";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

export function useSelector<T>(
  selector: (state: ApplicationState) => T,
  serverSelector?: (state: ApplicationState) => T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () =>
      serverSelector
        ? serverSelector(store.getState())
        : selector(store.getState()),
  );
}

/**
 * Whether this session's right-hand sidebar is open.
 *
 * Returns a boolean primitive, so `useSyncExternalStore`'s `Object.is` check
 * never sees a spurious change. The slice is `{}` on both server and client, so
 * the SSR snapshot and the first client render agree on `false`.
 */
export function useIsSidebarOpen(sessionId: string) {
  return useSelector((state) => state.isSidebarOpen[sessionId] ?? false);
}

export function useIsStreaming(sessionId: string) {
  return useSelector(
    (state) => state.sessions[sessionId]?.isStreaming ?? false,
  );
}

/**
 * Messages queued behind the running turn.
 *
 * Both return the stored array **by reference**, like every other selector
 * here. A `?? []` fallback would mint a fresh array on each call and spin
 * `useSyncExternalStore` forever, so callers handle `undefined` instead.
 */
export function useSteeringQueue(sessionId: string) {
  return useSelector((state) => state.sessions[sessionId]?.steering);
}

export function useFollowUpQueue(sessionId: string) {
  return useSelector((state) => state.sessions[sessionId]?.followUp);
}

/**
 * The label for a live session, derived from its explicit name or its first
 * user message.
 *
 * `undefined` until the SSE stream has delivered this session -- the sidebar
 * renders ids handed to it by the root loader, which can be a beat ahead of the
 * stream on a cold page load.
 */
export function useSessionTitle(sessionId: string): string | undefined {
  const name = useSelector((state) => state.sessions[sessionId]?.name);
  // `.find()` returns a reference held *by the store*, so repeated calls give
  // the same object back -- required for useSyncExternalStore's Object.is check
  const firstUserMessage = useSelector((state) =>
    state.sessions[sessionId]?.messages.find((m) => m.role === "user"),
  );

  return useMemo(() => {
    if (name) return name;
    if (!firstUserMessage) return undefined;

    const text =
      typeof firstUserMessage.content === "string"
        ? firstUserMessage.content
        : firstUserMessage.content.find((c) => c.type === "text")?.text;

    if (!text) return undefined;

    const skillBlock = parseSkillBlock(text);
    if (!skillBlock) return text;

    return skillBlock.userMessage || `/${skillBlock.name}` || text;
  }, [name, firstUserMessage]);
}

/**
 * Session statistics (token totals, cost, context-window usage).
 *
 * Returns the stored object by reference on purpose -- building a new object
 * here would make useSyncExternalStore re-render forever.
 *
 * `undefined` until the session is loaded.
 */
export function useSessionStats(sessionId: string) {
  return useSelector((state) => state.sessions[sessionId]?.stats);
}

export function useMessageCount(sessionId: string) {
  return useSelector(
    (state) => state.sessions[sessionId]?.messages.length ?? 0,
  );
}

export function useMessage(sessionId: string, messageIndex: number) {
  return useSelector(
    (state) => state.sessions[sessionId]?.messages[messageIndex],
  );
}

export function useToolResult(sessionId: string, toolCallId: string) {
  return useSelector((state) => {
    const messageIndex =
      state.sessions[sessionId]?.toolResultsByCallId[toolCallId];

    if (messageIndex === undefined) {
      return undefined;
    }

    return state.sessions[sessionId]?.messages[messageIndex] as
      | ToolResultMessage
      | undefined;
  });
}

export function usePartialToolResult(sessionId: string, toolCallId: string) {
  return useSelector(
    (state) =>
      state.sessions[sessionId]?.partialToolResultsByCallId[toolCallId],
  );
}

/**
 * Whether a single thinking block is currently streaming. Scoped to one block
 * (unlike `useIsStreaming`, which is true for the whole turn) so finished
 * thinking blocks stop showing "Thinking...".
 */
export function useIsThinking(
  sessionId: string,
  messageIndex: number,
  contentIndex: number,
) {
  return useSelector(
    (state) =>
      state.sessions[sessionId]?.isThinkingByContentId[
        thinkingContentId(messageIndex, contentIndex)
      ] ?? false,
  );
}
