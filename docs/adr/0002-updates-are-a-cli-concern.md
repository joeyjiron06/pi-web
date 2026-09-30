# Updating is a CLI concern, not a server concern

The Pi SDK update check runs in `bin/pi-web.js`, and the update itself only
ever runs from a terminal. The web app can *tell* you an update exists, but it
cannot apply one.

This is not a UI preference. The server cannot update itself:

- It is managed by PM2, and `pm2 delete pi-web` kills the whole process tree.
  Anything the server spawns to do the work is a grandchild of that tree, so it
  gets killed halfway through `pnpm add` or `pnpm build`, leaving a stopped
  server and a half-applied update. `detached: true` does not reliably escape
  `taskkill /T` on Windows either.
- Windows holds locks on `build/` and `node_modules` while the server runs, so
  the process has to be fully stopped before anything is rewritten.
- The HTTP response that starts an update can only ever say "started", because
  the server dies before the work finishes. Reporting progress would need a
  status file plus client polling plus a process-identity token to detect the
  restart.

The alternatives were a second PM2-owned process, or turning `bin/dev-server.js`
into a supervisor loop that relaunches the server after updating. Both work.
Both add a permanently-running piece of machinery to a personal tool in order to
save typing eleven characters. A terminal is not in the PM2 tree and needs none
of it.

## Consequences

- `bin/lib/updates.js` is shared by the CLI and the web server, so it must have
  **no dependencies** (`pi-web doctor` has to work when `node_modules` is
  broken) and must **never derive paths from `import.meta.url`** (vite bundles
  it into `build/server/index.js`). Every function takes `projectDir`.
- The web server runs the check itself rather than only reading the cache file.
  A server left running for weeks would otherwise report a weeks-old answer,
  which is the exact case the toast exists for. The two writers cannot clobber
  each other: whichever runs second sees `checkedOn === today` and writes
  nothing.
- The check shells out to `pnpm` rather than fetching a registry URL. There is a
  project `.npmrc` as well as one in the home directory, and whichever wins also
  carries the auth token and proxy. A hardcoded registry URL silently reports
  the wrong versions — during development the same command returned `0.87.1`
  through one registry and `0.99.2` through another.
- `pnpm add <pkg>@<version>`, never `pnpm update`. The ranges are `^0.85.1`, and
  for a `0.x` version caret means `>=0.85.1 <0.86.0`, so `update` does nothing
  at all.
- Rollback moves `build/` aside by rename before rebuilding. `react-router build`
  empties the directory before it writes, so once a build has failed there is no
  previous build left to fall back to. `pi-web reload` claimed to restart the
  previous build and could not actually do so.
- Two dismissals exist and are deliberately independent: `declined` in
  `.data/update-check.json` means "stop prompting me in this terminal today",
  and the `piUpdateDismissed` cookie means "stop showing me this toast today".
  They are usually different devices.
