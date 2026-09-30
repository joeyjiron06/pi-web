# Paths are canonicalised at the boundary, compared with `===`

Every filesystem path that enters the app goes through `resolvePath()` (tilde
expansion + `path.resolve`) at its point of entry, so separators, `.`/`..` and
trailing slashes are already canonical by the time anything stores or compares
one. Project paths and session cwds both come from `prepareWorkspace()`'s
`cwd`, so plain `===` is correct and we deliberately do **not** keep an
`isSamePath`/`normalizePath` helper for them — such a helper implies
un-normalised paths circulate, and invites callers to skip `resolvePath()`.

## Consequences

- Any new entry point that accepts a path from a user, a URL param or a config
  file must call `resolvePath()` before storing or comparing it. That is the
  load-bearing assumption.
- A git worktree is its own project. The workspace a session runs in is
  whatever `prepareWorkspace()` returns as `cwd`, and that folder is what gets
  added to the recent-projects list — a worktree gets its own sidebar row
  rather than nesting under the checkout it was cut from. This is what lets
  project/session matching stay a `===`.
- This does **not** extend to paths emitted by external tools. `git worktree
  list` returns posix-style paths on Windows (`C:/Users/...`), so
  `workspace.server.ts` keeps its own local `samePath()` for git output. It is
  scoped to the git boundary on purpose and must not be promoted to a utility.
- Case is not canonicalised. Windows paths are case-insensitive on disk, so two
  spellings of the same directory compare unequal. Accepted: every path we
  compare is produced by our own code from one source, never typed twice.
