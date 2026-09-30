/**
 * A simple Signal class that allows subscribing to events and emitting events. It uses the EventTarget API to manage event listeners and dispatch events.
 */
export default class Signal<E> {
  private readonly eventTarget = new EventTarget();

  subscribe(listener: (event: E) => void) {
    const handler = (event: Event) => {
      listener((event as CustomEvent<E>).detail);
    };

    this.eventTarget.addEventListener("event", handler);
    return () => {
      this.eventTarget.removeEventListener("event", handler);
    };
  }

  dispatch(event: E) {
    const customEvent = new CustomEvent("event", { detail: event });
    this.eventTarget.dispatchEvent(customEvent);
  }
}
