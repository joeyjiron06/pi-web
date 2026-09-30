import Signal from "~/lib/signal";
import { reducer } from "./reducer";
import type { ApplicationState, Action } from "./types";
import type { SessionEvent } from "~/services/sessions.server";

const dispatcher = new Signal<void>();

const initialState: ApplicationState = {
  sessions: {},
  isSidebarOpen: {},
};

let state: ApplicationState = initialState;

/**
 * Main application store to store global state in the client.
 *
 * We need sessions as a global state because multiple components may need to access and update session information consistently.
 */
export const store = {
  subscribe(listener: () => void) {
    return dispatcher.subscribe(listener);
  },

  getState(): ApplicationState {
    return state;
  },

  dispatch(action: Action) {
    const prevState = state;
    state = reducer(state, action);

    if (prevState !== state) {
      dispatcher.dispatch();
    }
  },

  connect() {
    const source = new EventSource("/sessions/events");
    let closed = false;

    // Stream-level snapshot (all live sessions)
    source.addEventListener("session_event", (raw: Event) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as SessionEvent;

        if (data.type === "session_agent_event") {
          console.log(
            "[agent_event]",
            data.payload.event.type,
            data.payload.event,
          );
        }
        store.dispatch(data);
      } catch (error) {
        console.error("[sessions] Failed to parse stream_snapshot", error);
      }
    });

    return () => {
      closed = true;
      source?.close();
    };
  },
};
