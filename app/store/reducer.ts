import type { SessionSnapshot } from "~/services/sessions.server";
import type { Action, ApplicationState, SessionState } from "./types";
import { thinkingContentId } from "./types";
import { set, del, wrap } from "~/lib/object-path-immutable";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export function reducer(
  state: ApplicationState,
  action: Action,
): ApplicationState {
  switch (action.type) {
    case "live_sessions_snapshot":
      return handleLiveSessionsSnapshot(state, action.payload);

    case "session_created":
      return handleSessionCreated(state, action.payload);

    case "session_removed":
      return handleSessionRemoved(state, action.payload.sessionId);

    case "session_agent_event":
      return handleSessionAgentEvent(
        state,
        action.payload.sessionId,
        action.payload.event,
      );

    case "session_model_changed": {
      // object-path-immutable's `set` *creates* missing intermediate objects, so
      // without this guard an event for a session we haven't loaded would
      // fabricate a half-built `sessions.<id>` entry holding only `model` --
      // which the route would then treat as a loaded session and try to render.
      if (!state.sessions[action.payload.sessionId]) return state;

      return set(
        state,
        `sessions.${action.payload.sessionId}.model`,
        action.payload.model,
      );
    }

    case "session_stats_changed": {
      // same guard as above: `set` would otherwise fabricate a
      // `sessions.<id>` entry holding only `stats` for a session this client
      // has never loaded, and the route would treat it as a loaded session
      if (!state.sessions[action.payload.sessionId]) return state;

      return set(
        state,
        `sessions.${action.payload.sessionId}.stats`,
        action.payload.stats,
      );
    }

    case "sidebar_toggled": {
      const { sessionId } = action.payload;

      // `set` returns a new object, which is what `store.dispatch`'s identity
      // check relies on to notify subscribers -- don't be tempted to mutate.
      return set(
        state,
        `isSidebarOpen.${sessionId}`,
        !state.isSidebarOpen[sessionId],
      );
    }

    default:
      return state;
  }
}

function handleLiveSessionsSnapshot(
  state: ApplicationState,
  sessionsSnapshot: Record<string, SessionSnapshot>,
): ApplicationState {
  const sessions: Record<string, SessionState> = {
    ...state.sessions,
  };

  for (const [sessionId, sessionSnapshot] of Object.entries(sessionsSnapshot)) {
    sessions[sessionId] = createClientSessionState(
      sessionSnapshot,
      state.sessions[sessionId],
    );
  }

  return set(state, "sessions", sessions);
}

function handleSessionCreated(
  state: ApplicationState,
  sessionState: SessionSnapshot,
): ApplicationState {
  return set(
    state,
    `sessions.${sessionState.sessionId}`,
    createClientSessionState(sessionState),
  );
}

function handleSessionRemoved(
  state: ApplicationState,
  sessionId: string,
): ApplicationState {
  return del(state, `sessions.${sessionId}`);
}

/**
 * Inspired by PI TUI
 *
 * Handling events
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3071
 *
 * and handing message updates
 * https://github.com/earendil-works/pi/blob/9795d602306ef68a97585909e8e79f92a389057b/packages/ai/src/api/pi-messages.ts#L189
 */
function handleSessionAgentEvent(
  state: ApplicationState,
  sessionId: string,
  event: AgentSessionEvent,
): ApplicationState {
  const session = state.sessions[sessionId];

  if (!session) {
    return state;
  }

  switch (event.type) {
    case "agent_start": {
      return set(state, `sessions.${sessionId}.isStreaming`, true);
    }

    case "agent_end": {
      // Deliberately does NOT clear isStreaming. `agent_end` is not idle: pi may
      // still auto-retry, auto-compact, or drain a queued message and emit
      // another `agent_start`. `agent_settled` is the real end of the run.
      //
      // A finished turn has nothing in flight, so every thinking block is done.
      // Resetting also cleans up blocks that never got a `thinking_end` because
      // the turn was aborted or errored -- otherwise they'd shimmer forever.
      return set(state, `sessions.${sessionId}.isThinkingByContentId`, {});
    }

    // The one event that means "the agent is done": pi clears its internal
    // `_isAgentRunActive` immediately before emitting this. If it is ever missed
    // (a dropped SSE connection), reconnecting replays `live_sessions_snapshot`,
    // which rebuilds isStreaming from the server.
    case "agent_settled": {
      return set(state, `sessions.${sessionId}.isStreaming`, false);
    }

    // Messages the user queued behind the running turn. pi emits this on every
    // queue change, including the removal that happens just before it delivers
    // a message -- so the list empties on its own as the agent picks each up.
    case "queue_update": {
      return wrap(state)
        .set(`sessions.${sessionId}.steering`, [...event.steering])
        .set(`sessions.${sessionId}.followUp`, [...event.followUp])
        .value();
    }

    // pi clamps the requested level to what the model supports, so this event
    // -- not what the client submitted -- is the source of truth for the picker
    case "thinking_level_changed": {
      return set(state, `sessions.${sessionId}.thinkingLevel`, event.level);
    }

    case "message_start": {
      const messageIndex = session.messages.length;
      const message = event.message;

      let nextState = wrap(state).push(
        `sessions.${sessionId}.messages`,
        message,
      );

      if (message.role === "toolResult") {
        nextState = nextState.set(
          `sessions.${sessionId}.toolResultsByCallId.${message.toolCallId}`,
          messageIndex,
        );
      }

      return nextState.value();
    }

    case "message_update": {
      const messageIndex = session.messages.length - 1;
      const message = event.message;

      let nextState = wrap(state).set(
        `sessions.${sessionId}.messages.${messageIndex}`,
        message,
      );

      const assistantMessageEvent = event.assistantMessageEvent;

      if (
        assistantMessageEvent?.type === "thinking_start" ||
        assistantMessageEvent?.type === "thinking_end"
      ) {
        const contentId = thinkingContentId(
          messageIndex,
          assistantMessageEvent.contentIndex,
        );

        nextState = nextState.set(
          `sessions.${sessionId}.isThinkingByContentId.${contentId}`,
          assistantMessageEvent.type === "thinking_start",
        );
      }

      return nextState.value();
    }

    case "message_end": {
      const messageIndex = session.messages.length - 1;
      const message = event.message;

      let nextState = wrap(state).set(
        `sessions.${sessionId}.messages.${messageIndex}`,
        message,
      );

      // The model can stop mid-thought (abort/error), in which case
      // `thinking_end` never arrives. The message is final here, so nothing in
      // it can still be streaming.
      const clearedThinking = clearThinkingForMessage(session, messageIndex);

      if (clearedThinking !== session.isThinkingByContentId) {
        nextState = nextState.set(
          `sessions.${sessionId}.isThinkingByContentId`,
          clearedThinking,
        );
      }

      if (message.role === "toolResult") {
        nextState = nextState.del(
          `sessions.${sessionId}.partialToolResultsByCallId.${message.toolCallId}`,
        );
      }

      return nextState.value();
    }

    // live tool output
    // tool_execution_start and tool_execution_end are deliberately unhandled: the
    // tool result message carries everything we render, and tool_execution_end
    // fires only a few milliseconds before it.
    case "tool_execution_update": {
      return set(
        state,
        `sessions.${sessionId}.partialToolResultsByCallId.${event.toolCallId}`,
        event.partialResult,
      );
    }

    default:
      return state;
  }
}

/**
 * Inspired by PI TUI where it restores a session from messages
 *
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3566
 */
function createClientSessionState(
  serverSessionState: SessionSnapshot,
  previous?: SessionState,
): SessionState {
  const toolResultsByCallId: Record<string, number> = {};

  serverSessionState.messages.forEach((message, index) => {
    if (message.role === "toolResult") {
      toolResultsByCallId[message.toolCallId] = index;
    }
  });

  return {
    ...serverSessionState,
    toolResultsByCallId,
    partialToolResultsByCallId: {},
    // A snapshot can arrive while a turn is in flight (e.g. the SSE stream
    // reconnected), so keep whatever we already knew about live thinking
    // blocks rather than dropping them mid-thought.
    isThinkingByContentId: previous?.isThinkingByContentId ?? {},
  };
}

/**
 * Returns a copy of the session's thinking flags with every block belonging to
 * `messageIndex` marked as finished. Returns the same reference when there is
 * nothing to clear, so we don't churn state on every message end.
 */
function clearThinkingForMessage(
  session: SessionState,
  messageIndex: number,
): Record<string, boolean> {
  const prefix = `${messageIndex}:`;
  const current = session.isThinkingByContentId;
  const stillThinking = Object.keys(current).filter(
    (contentId) => current[contentId] && contentId.startsWith(prefix),
  );

  if (stillThinking.length === 0) {
    return current;
  }

  const next = { ...current };

  for (const contentId of stillThinking) {
    next[contentId] = false;
  }

  return next;
}
