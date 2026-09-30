import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type PromptOptions,
  type SessionInfo,
  type SessionStats,
} from "@earendil-works/pi-coding-agent";
import { getModels } from "./models.server";
import {
  deleteSessionAttachments,
  sweepStaleAttachments,
} from "./attachments.server";

// Attachment folders outlive the process that made them, so a crashed or
// killed server would leak every file it was ever handed. Swept once per boot,
// best effort, never blocking startup.
void sweepStaleAttachments().catch((error) => {
  console.error("Failed to sweep stale attachments:", error);
});

// ---------------------------------------------------------------------------
// Global instances that survives Vite HMR module reloads
// for local development, but not for production builds. In production, this is a singleton
// because the server is long-lived and the module is only loaded once.
// ---------------------------------------------------------------------------
declare global {
  var __liveSessions: Map<string, AgentSession> | undefined;
  var __loadedSessions: Map<string, Promise<AgentSession>> | undefined;
  var __listeners: Set<(event: SessionEvent) => void> | undefined;
}

const liveSessions = global.__liveSessions
  ? global.__liveSessions
  : (global.__liveSessions = new Map<string, AgentSession>());

/**
 * Sessions read off disk but *not* live (no subscription, no prompting).
 *
 * Stores the in-flight promise rather than the resolved session: two concurrent
 * loads of the same id (loader + action, or two browser tabs) would otherwise
 * both miss the cache and construct two AgentSession objects over one file.
 */
const loadedSessions = global.__loadedSessions
  ? global.__loadedSessions
  : (global.__loadedSessions = new Map<string, Promise<AgentSession>>());

const listeners = global.__listeners
  ? global.__listeners
  : (global.__listeners = new Set<(event: SessionEvent) => void>());

/**
 * A JSON serializable snapshot of a session's state, suitable for sending to the client. This is a subset of the full AgentSession object, containing only the information that the client needs to display and interact with the session.
 */
export type SessionSnapshot = {
  sessionId: string;

  name: string;

  cwd: string;

  isStreaming: boolean;

  isLive: boolean;

  /**
   * Steering messages queued behind the running turn, in delivery order. pi
   * delivers these once the current assistant turn finishes its tool calls.
   *
   * Always a copy: `getSteeringMessages()` hands back pi's own internal array
   * by reference, which would otherwise mutate under us.
   */
  steering: string[];

  /** Queued follow-up messages, delivered only once the agent stops entirely. */
  followUp: string[];

  messages: AgentMessage[];

  model?: Model<any>;

  thinkingLevel?: ThinkingLevel;

  stats?: SessionStats;
};

export type SessionEvent =
  | { type: "session_created"; payload: SessionSnapshot }
  | { type: "session_removed"; payload: { sessionId: string } }
  | {
      type: "session_agent_event";
      payload: { sessionId: string; event: AgentSessionEvent };
    }
  | {
      type: "live_sessions_snapshot";
      payload: Record<string, SessionSnapshot>;
    }
  | {
      type: "session_model_changed";
      payload: { sessionId: string; model: Model<any> };
    }
  | {
      type: "session_stats_changed";
      payload: { sessionId: string; stats: SessionStats };
    };

/**
 * Agent events after which the session's stats (and therefore its context
 * usage) can have changed.
 *
 * `message_update` is deliberately absent: it fires once per streamed token
 * delta, and getSessionStats() walks every message in the session.
 */
const STATS_CHANGING_EVENTS = new Set<AgentSessionEvent["type"]>([
  "message_end",
  "agent_end",
  "compaction_end",
]);

type CreateSessionOptions = {
  // Current working directory
  cwd: string;

  thinkingLevel?: ThinkingLevel;

  /**
   * The model to run. Omit to let pi pick its own default; if given, it must
   * resolve to an available model or this throws.
   */
  model?: Pick<Model<any>, "provider" | "id">;
};

/**
 * Create a new session
 */
export async function createSession(options: CreateSessionOptions) {
  const models = await getModels();
  const requested = options.model;
  let model: Model<Api> | undefined;

  if (requested) {
    model = models.find(
      (m) => m.id === requested.id && m.provider === requested.provider,
    );

    // an unresolvable model used to fall through as `undefined`, which pi
    // silently replaces with its own default -- so the user would get a
    // different model than the one they picked, with no indication. this
    // happens when the model is gone from models.json or the provider's auth
    // has lapsed (getModels() only returns *available* models).
    if (!model) {
      throw new Error(
        `Model "${requested.provider}/${requested.id}" is not available. It may have been removed, or its provider may need to be authenticated.`,
      );
    }
  }

  const { session } = await createAgentSession({
    cwd: options.cwd,
    thinkingLevel: options.thinkingLevel,
    model,
  });

  registerLiveSession(session);

  return session;
}

/**
 * Promote a session to "live": track it, bridge its agent events onto our own
 * listeners, and announce it.
 *
 * Shared by `createSession` and `resumeSession` so a brand new session and one
 * resumed from disk can't drift apart in how they're wired up.
 */
function registerLiveSession(session: AgentSession) {
  // idempotency guard: a second registration would subscribe twice and every
  // agent event would reach the client duplicated.
  if (liveSessions.has(session.sessionId)) {
    return;
  }

  liveSessions.set(session.sessionId, session);

  session.subscribe((event: AgentSessionEvent) => {
    emit({
      type: "session_agent_event",
      payload: { sessionId: session.sessionId, event },
    });

    // pi never streams context usage in an event -- the only source of truth is
    // AgentSession.getContextUsage(), which getSessionStats() embeds. So it has
    // to be re-read after the events that can move it.
    if (STATS_CHANGING_EVENTS.has(event.type)) {
      emitSessionStats(session);
    }
  });

  emit({
    type: "session_created",
    payload: sessionStateFromAgentSession(session),
  });
}

/**
 * Stop a session and remove it from the live sessions map. This will also abort any ongoing operations in the session and dispose of its resources.
 */
export async function stopSession(sessionId: string): Promise<void> {
  const session = liveSessions.get(sessionId);
  if (!session) {
    return;
  }

  await session.abort();
  session.dispose();

  // No clearQueue() here, unlike abortSession: the session is being disposed,
  // so there is no post-run loop left to deliver anything that was queued.
  liveSessions.delete(sessionId);
  // a disposed session must not stay reachable through the load cache
  loadedSessions.delete(sessionId);

  // attachments are only meaningful to the conversation that referenced them
  void deleteSessionAttachments(sessionId);

  emit({
    type: "session_removed",
    payload: { sessionId },
  });
}

/**
 * Stop every live session running in `cwd`. Used when a project is removed from
 * the sidebar: the project row is the only way to reach its live sessions, so
 * leaving them running would strand them with no UI to stop them.
 *
 * Returns the ids that were stopped. Sessions are still on disk afterwards --
 * `stopSession` only tears down the in-memory agent.
 */
export async function stopSessionsForCwd(cwd: string): Promise<string[]> {
  const matching = Array.from(liveSessions.values())
    .filter((session) => session.sessionManager.getCwd() === cwd)
    .map((session) => session.sessionId);

  // stop them all in parallel, but don't fail the whole batch if one fails
  await Promise.allSettled(matching.map((sessionId) => stopSession(sessionId)));

  return matching;
}

export function getLiveSession(sessionId: string): AgentSession | undefined {
  return liveSessions.get(sessionId);
}

/**
 * Every live session. In-memory and synchronous, so callers (the root loader)
 * can group them by cwd without touching the disk.
 */
export function listLiveSessions(): AgentSession[] {
  return Array.from(liveSessions.values());
}

/**
 * Load session details, but don't necessarily mark it as live. This is used to load a snapshot of a saved session, which may not be currently live.
 */
export function loadSession(sessionId: string): Promise<AgentSession> {
  const live = liveSessions.get(sessionId);
  if (live) return Promise.resolve(live);

  const cached = loadedSessions.get(sessionId);
  if (cached) return cached;

  // deliberately not an `async function`: the map entry has to be set
  // *synchronously*, otherwise two callers in the same tick both miss the cache
  // and we end up with two AgentSession objects over the same file.
  const pending = (async () => {
    const all = await SessionManager.listAll();
    const info = all.find((s) => s.id === sessionId);
    if (!info) throw new Error(`Session not found: ${sessionId}`);

    const { session } = await createAgentSession({
      cwd: info.cwd,
      sessionManager: SessionManager.open(info.path),
    });

    return session;
  })();

  loadedSessions.set(sessionId, pending);
  // a failed load must not be cached forever
  pending.catch(() => loadedSessions.delete(sessionId));

  return pending;
}

/**
 * Make a saved session live again so it can be prompted. No-op for a session
 * that is already live.
 */
export async function resumeSession(sessionId: string): Promise<AgentSession> {
  const live = liveSessions.get(sessionId);
  if (live) return live;

  const session = await loadSession(sessionId);

  // it's live from here on, so the "loaded but not live" cache must let go of it
  loadedSessions.delete(sessionId);
  // safe to call twice: two rapid submits both land here, and
  // registerLiveSession returns early for an already-tracked session
  registerLiveSession(session);

  return session;
}

/**
 * Switch the model of a live session.
 */
export async function updateSessionModel(
  sessionId: string,
  modelRef: Pick<Model<Api>, "provider" | "id">,
) {
  const session = liveSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session with id ${sessionId} not found`);
  }

  const models = await getModels();
  const model = models.find(
    (m) => m.id === modelRef.id && m.provider === modelRef.provider,
  );

  // same failure mode createSession guards against: getModels() only returns
  // *available* models, so a miss means it was removed from models.json or the
  // provider's auth lapsed. Falling through as undefined would silently keep
  // the old model with no indication to the user.
  if (!model) {
    throw new Error(
      `Model "${modelRef.provider}/${modelRef.id}" is not available. It may have been removed, or its provider may need to be authenticated.`,
    );
  }

  await session.setModel(model);

  emit({
    type: "session_model_changed",
    payload: { sessionId, model },
  });

  // a different model means a different context window, so the usage percentage
  // changes even though no new tokens were spent
  emitSessionStats(session);
}

/**
 * Set the thinking level of a live session.
 */
export function updateSessionThinkingLevel(
  sessionId: string,
  level: ThinkingLevel,
) {
  // no emit(): pi fires its own `thinking_level_changed` event, which already
  // reaches the client through the session_agent_event bridge. It also *clamps*
  // the level to the model's capabilities, so that event is the source of
  // truth -- never the value the client submitted.
  liveSessions.get(sessionId)?.setThinkingLevel(level);
}

/**
 * Abort the in-flight agent turn of a live session and drop everything queued
 * behind it. A no-op if it isn't live, so repeat aborts are harmless.
 *
 * `clearQueue()` MUST come first. pi's `abort()` does not touch the queues, and
 * `_handlePostAgentRun()` then calls `agent.continue()` for whatever is left --
 * so a bare `abort()` immediately restarts the agent on the very message the
 * user was trying to cancel. pi's own RPC docs tell clients to clear first.
 *
 * Returns the cleared messages so the caller can put them back in the composer
 * rather than destroying text the user typed.
 */
export async function abortSession(sessionId: string): Promise<string[]> {
  const session = liveSessions.get(sessionId);
  if (!session) {
    return [];
  }

  // clearQueue() emits `queue_update` itself, so the client's list empties
  // through the normal SSE bridge with no help from us.
  const { steering, followUp } = session.clearQueue();
  await session.abort();

  return [...steering, ...followUp];
}

/**
 * Drop every queued steering and follow-up message without touching the running
 * turn. Returns them so the caller can restore them to the composer.
 */
export function clearSessionQueue(sessionId: string): string[] {
  const session = liveSessions.get(sessionId);
  if (!session) {
    return [];
  }

  const { steering, followUp } = session.clearQueue();
  return [...steering, ...followUp];
}

export function isLiveSession(sessionId: string): boolean {
  return liveSessions.has(sessionId);
}

export function requestSnapshot(sessionId: string) {
  const liveSession = liveSessions.get(sessionId);
  if (liveSession) {
    emit({
      type: "session_created",
      payload: sessionStateFromAgentSession(liveSession),
    });
  } else {
    loadSession(sessionId)
      .then((session) => {
        emit({
          type: "session_created",
          payload: sessionStateFromAgentSession(session),
        });
      })
      .catch((error) => {
        console.error(`Failed to load session ${sessionId}:`, error);
      });
  }
}

/**
 * List all saved sessions from the session manager. This will return an array of SessionInfo objects, which contain metadata about each saved session.
 */
export async function listSavedSessions(): Promise<SessionInfo[]> {
  const sessions = await SessionManager.listAll();
  return sessions
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, 50);
}

/**
 * The result of handing a prompt to pi.
 *
 * "Accepted" means pi took the prompt -- it started a turn, queued the message,
 * or ran it as an extension command. It does NOT mean the turn succeeded;
 * failures after acceptance arrive through the event stream instead.
 */
export type PromptOutcome = { accepted: true } | { accepted: false; error: string };

/**
 * Prompt the specified session with the given text and options.
 *
 * Resolves as soon as pi accepts or rejects the prompt, NOT when the turn ends.
 * That distinction is the whole point of `preflightResult`: `prompt()` itself
 * stays pending for the length of the turn (potentially minutes), which would
 * hang the POST that called us.
 */
export async function sessionPrompt(
  sessionId: string,
  text: string,
  promptOptions?: PromptOptions,
): Promise<PromptOutcome> {
  const session = liveSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session with id ${sessionId} not found`);
  }

  let signalPreflight: (accepted: boolean) => void = () => {};
  const preflight = new Promise<boolean>((resolve) => {
    signalPreflight = resolve;
  });

  const run = session.prompt(text, {
    ...promptOptions,
    preflightResult: (accepted) => signalPreflight(accepted),
  });

  // The rejection is consumed here and turned into a value, so a prompt that
  // fails after we've already returned can never surface as an unhandled
  // rejection and take down the process.
  const settled = run.then(
    () => undefined,
    (error: unknown) => error ?? new Error("Unknown error"),
  );

  // Raced rather than a bare `await preflight`: pi has a defensive branch that
  // returns from prompt() without ever calling preflightResult. Without the
  // race that path would leave this request hanging forever.
  const accepted = await Promise.race([
    preflight,
    settled.then((error) => error === undefined),
  ]);

  if (accepted) {
    return { accepted: true };
  }

  // Awaited only on the failure path, where `prompt()` has already rejected --
  // pi calls preflightResult(false) immediately before it throws.
  const error = await settled;

  return {
    accepted: false,
    error:
      error instanceof Error
        ? error.message
        : "The agent rejected the prompt",
  };
}

export function subscribeToSessionEvents(
  callback: (event: SessionEvent) => void,
) {
  listeners.add(callback);

  callback({
    type: "live_sessions_snapshot",
    payload: getLiveSessionStates(),
  });

  return () => {
    listeners.delete(callback);
  };
}

function emit(event: SessionEvent) {
  listeners.forEach((listener) => listener(event));
}

function emitSessionStats(session: AgentSession) {
  emit({
    type: "session_stats_changed",
    payload: {
      sessionId: session.sessionId,
      stats: session.getSessionStats(),
    },
  });
}

function getLiveSessionStates() {
  return Object.fromEntries(
    Array.from(liveSessions.entries()).map(([sessionId, session]) => [
      sessionId,
      sessionStateFromAgentSession(session),
    ]),
  );
}

export function sessionStateFromAgentSession(
  session: AgentSession,
): SessionSnapshot {
  return {
    sessionId: session.sessionId,
    // the project directory the agent runs in. NOT getSessionDir(), which is
    // the *storage* dir (~/.pi/agent/sessions/<encoded-cwd>/).
    cwd: session.sessionManager.getCwd(),
    name: session.sessionName || "",
    isStreaming: session.isStreaming,
    isLive: liveSessions.has(session.sessionId),
    // copied: pi returns its live internal arrays by reference
    steering: [...session.getSteeringMessages()],
    followUp: [...session.getFollowUpMessages()],
    messages: session.messages,
    model: session.model!,
    thinkingLevel: session.thinkingLevel,
    stats: session.getSessionStats(),
  };
}
