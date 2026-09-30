import Nova from "nova-cache";
import NovaMemoryStore from "nova-cache/store/memory";

// ---------------------------------------------------------------------------
// Global cache — one Nova instance survives Vite HMR module reloads
// for local development, but not for production builds. In production, this is a singleton
// because the server is long-lived and the module is only loaded once.
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __cache: Nova | undefined;
}

const cache = global.__cache
  ? global.__cache
  : (global.__cache = new Nova({
      store: new NovaMemoryStore(),
    }));

export default cache;
