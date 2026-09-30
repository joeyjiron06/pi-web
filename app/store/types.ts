import type {
  AgentMessage,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";
import type { SessionEvent, SessionSnapshot } from "~/services/sessions.server";

export type AgentMessageWithId = AgentMessage & { id: string };

export type SessionState = SessionSnapshot & {
  // Mapping of tool call IDs to their message index in the messages array.
  // This allows for quick lookup of tool call messages by their unique call ID.
  toolResultsByCallId: Record<string, number>;

  /** Tool call id -> live output of a running tool. Deleted when its result lands. */
  partialToolResultsByCallId: Record<string, AgentToolResult<unknown>>;

  /**
   * Thinking content id (see `thinkingContentId`) -> whether that thinking
   * block is *currently* streaming. `true` between the `thinking_start` and
   * `thinking_end` assistant message events, `false` afterwards.
   *
   * Sessions restored from disk have no entries, so a missing key reads as
   * "not thinking".
   */
  isThinkingByContentId: Record<string, boolean>;
};

/**
 * Identifies a single thinking block inside a session. A message can contain
 * more than one thinking block, so the content index is part of the id.
 */
export function thinkingContentId(
  messageIndex: number,
  contentIndex: number,
): string {
  return `${messageIndex}:${contentIndex}`;
}

export type ApplicationState = {
  sessions: Record<string, SessionState>;

  /**
   * Session id -> is that session's right-hand detail sidebar open. Missing
   * reads as closed.
   *
   * Deliberately a *sibling* of `sessions` rather than a field on
   * `SessionState`: `live_sessions_snapshot` rebuilds every entry through
   * `createClientSessionState`, and `session_removed` deletes them outright, so
   * anything stored in there would be silently wiped by server traffic.
   */
  isSidebarOpen: Record<string, boolean>;
};

/** Client-only actions. Everything else in `Action` originates on the server. */
export type UiAction = {
  type: "sidebar_toggled";
  payload: { sessionId: string };
};

export type Action = SessionEvent | UiAction;
