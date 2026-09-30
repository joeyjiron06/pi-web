import {
  subscribeToSessionEvents,
  type SessionEvent,
} from "~/services/sessions.server";

export function loader() {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe: () => void = () => {};

      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch (error) {
          console.error("[sessions/events] Failed to send SSE event", error);
          closed = true;
        }
      }

      function init() {
        // Prime the connection
        send("ping", { start: Date.now() });

        unsubscribe = subscribeToSessionEvents((event: SessionEvent) => {
          send("session_event", event);
        });
      }

      init();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
