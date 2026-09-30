import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolvePath } from "~/services/fs.server";

const execFileAsync = promisify(execFile);

/**
 * A git command that exited non-zero. `message` is git's own stderr, which we
 * surface to the user verbatim rather than paraphrasing it.
 */
export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

/**
 * A single status character from `git status --porcelain`.
 *
 * `" "` means "unmodified on this side" -- a file modified in the worktree but
 * not staged is `{ staged: " ", unstaged: "M" }`.
 *
 * @see https://git-scm.com/docs/git-status#_short_format
 */
export type GitStatusCode =
  | " " // unmodified
  | "M" // modified
  | "T" // type changed (file <-> symlink/submodule)
  | "A" // added
  | "D" // deleted
  | "R" // renamed
  | "C" // copied
  | "U" // updated but unmerged (conflict)
  | "?" // untracked
  | "!"; // ignored

export type GitFileChange = {
  /**
   * Path relative to the *repo root*, POSIX-style. Note this is not relative to
   * the directory the Git instance was created with -- git always reports from
   * the root, and a commit spans the whole repo, so the panel shows the root.
   */
  path: string;

  /** Status of the index (staged side). */
  staged: GitStatusCode;

  /** Status of the working tree (unstaged side). */
  unstaged: GitStatusCode;

  /** Previous path for renames and copies, otherwise `null`. */
  originalPath: string | null;
};

/**
 * Which pair of blobs a diff compares. Mirrors the two columns of
 * `git status`, and therefore the two sections of the changes panel.
 *
 * - `staged`: `HEAD` vs the index -- what a commit right now would record
 * - `unstaged`: the index vs the file on disk -- what is not yet staged
 */
export type GitDiffSide = GitChangeSide;

/**
 * The two sides of a single file's diff, already decoded to text.
 *
 * Two full blobs rather than a unified patch: the viewer is Monaco's
 * `DiffEditor`, which computes and renders the diff itself and gives us
 * syntax highlighting for free. A patch would have to be re-parsed client-side
 * and highlighted by hand.
 *
 * A missing blob (an untracked file has no `HEAD` side, a deleted file has no
 * worktree side) is an empty string, which is exactly how the diff should
 * render it.
 */
export type GitDiffContent = {
  /** repo-root-relative path of the *new* side */
  path: string;
  /** pre-rename path, when the change is a rename or copy */
  originalPath: string | null;
  side: GitDiffSide;
  original: string;
  modified: string;
  /**
   * Either side looks like binary data. Both texts are empty when set -- the
   * viewer shows a notice instead, since Monaco would render mojibake.
   */
  isBinary: boolean;
  /** Either side exceeded {@link MAX_DIFF_BYTES}. Both texts are empty. */
  isTooLarge: boolean;
};

export type WorktreeEntry = {
  /** absolute path of the worktree */
  path: string;
  /** checked out branch, or null when detached */
  branch: string | null;
};

export type Git = {
  /** Absolute path this Git instance operates on. */
  readonly directory: string;

  /** Whether `directory` is inside a git repository (or worktree). */
  isGitRepo(): Promise<boolean>;

  /**
   * The current branch name, or `null` when HEAD is detached
   * (e.g. checked out to a tag or a specific commit).
   */
  getCurrentBranchName(): Promise<string | null>;

  /** Whether `directory` belongs to a linked worktree (not the main one). */
  isWorktree(): Promise<boolean>;

  /** Local branch names. Empty for a repo with no commits yet. */
  listBranches(): Promise<string[]>;

  /**
   * Every tracked and untracked file below `directory`, as repo-relative
   * POSIX-style paths, with `.gitignore` rules applied. Ignored files are
   * excluded, which is exactly what a file picker wants.
   *
   * Returns `null` when git can't answer (not a repo, git missing, output too
   * large) so callers can fall back to walking the filesystem themselves.
   */
  listFiles(): Promise<string[] | null>;

  /**
   * Best guess at the repo's default branch: `origin/HEAD` if it's set,
   * otherwise `main`/`master` if either exists, otherwise the current branch.
   */
  getMainBranch(): Promise<string>;

  /**
   * Every worktree attached to this repo, including the main one. Used to
   * detect that a branch is already checked out somewhere else, which git
   * forbids.
   */
  listWorktrees(): Promise<WorktreeEntry[]>;

  /**
   * Absolute path of the repo root (`git rev-parse --show-toplevel`), or `null`
   * when `directory` isn't inside a repo. Needed because `directory` is often a
   * subdirectory, while status paths are reported relative to the root.
   */
  getRepoRoot(): Promise<string | null>;

  /**
   * Every file with staged or unstaged changes, including untracked ones,
   * as repo-root-relative POSIX paths.
   *
   * Returns `[]` for a clean repo. Returns `[]` rather than throwing when the
   * directory isn't a repo, so the panel can render an empty state.
   */
  status(): Promise<GitFileChange[]>;

  /** Whether `ref` resolves to something (branch, tag, sha). */
  refExists(ref: string): Promise<boolean>;

  /**
   * The before/after contents for one changed file, for the diff viewer.
   *
   * `path` is repo-root-relative (as reported by {@link Git.status}), so this
   * instance's directory must be the repo root.
   *
   * Never throws for a missing blob: an untracked file simply has no `HEAD`
   * side and a deleted file has no worktree side, and both are legitimate
   * states to diff.
   */
  diff(options: {
    path: string;
    originalPath?: string | null;
    side: GitDiffSide;
  }): Promise<GitDiffContent>;

  /**
   * Stages `paths` (`git add -A`), which are resolved relative to this
   * instance's `directory`. `-A` rather than a plain add so deletions stage
   * too, which a plain `git add <path>` would skip.
   *
   * A no-op for an empty list: a bare `git add -A --` would stage the entire
   * repository, which is never what an empty selection means.
   *
   * Throws {@link GitCommandError} with git's stderr on failure -- notably for
   * a pathspec that matches nothing.
   */
  stage(paths: string[]): Promise<void>;

  /**
   * Removes `paths` from the index (`git restore --staged`), leaving the
   * working tree untouched -- a staged new file goes back to untracked, an
   * edit back to unstaged. Nothing is ever lost from disk.
   *
   * A no-op for an empty list: `git restore --staged` with no pathspec would
   * empty the whole index.
   *
   * Throws {@link GitCommandError} with git's stderr on failure.
   */
  unstage(paths: string[]): Promise<void>;

  /**
   * Rewrites `paths` in the working tree from the index (`git restore`),
   * throwing away uncommitted edits. Staged content is kept, so a file with
   * both staged and unstaged edits keeps the staged half.
   *
   * Irreversible: the discarded content exists nowhere in git afterwards.
   *
   * Only works for *tracked* paths -- git has nothing to restore an untracked
   * file from, and errors with "pathspec did not match". Use
   * {@link Git.removeUntracked} for those.
   *
   * A no-op for an empty list: a bare `git restore --` would revert the whole
   * working tree.
   */
  restoreWorktree(paths: string[]): Promise<void>;

  /**
   * Deletes untracked `paths` from disk (`git clean -f -d`). `-d` also removes
   * directories left empty. Deliberately *not* `-x`, so ignored files
   * (`node_modules`, `.env`) are never touched, and deliberately not `-ff`,
   * so a nested git repository is never destroyed -- see below.
   *
   * Irreversible. A no-op for an empty list, which would otherwise clean the
   * entire working tree.
   *
   * Throws {@link GitCommandError} when a path survives the clean. `git clean`
   * *silently skips* a directory that contains its own `.git` and still exits
   * 0, so without this check the caller reports success for a delete that
   * never happened.
   */
  removeUntracked(paths: string[]): Promise<void>;

  /**
   * Commits whatever is currently in the index (`git commit -m`). Deliberately
   * *not* `-a`: the panel's "Staged Changes" section is the source of truth, so
   * unstaged edits must never sneak into a commit.
   *
   * Throws {@link GitCommandError} with git's stderr on failure -- an empty
   * index, a rejecting pre-commit hook, or missing user.name/user.email.
   */
  commit(message: string): Promise<void>;

  /**
   * Pushes the current branch. When the branch has no upstream (a freshly
   * created local branch), publishes it with `--set-upstream origin <branch>`
   * instead, so the first push of a new branch doesn't need a separate step.
   *
   * Throws {@link GitCommandError} with git's stderr on failure -- notably a
   * non-fast-forward rejection or a missing `origin`.
   */
  push(): Promise<void>;

  /**
   * Checks out an existing branch. Throws {@link GitCommandError} with git's
   * stderr on failure — notably when local changes would be overwritten.
   */
  checkout(branch: string): Promise<void>;

  /** Creates `branch` from `base` and checks it out. */
  checkoutNewBranch(branch: string, base: string): Promise<void>;

  /** `git worktree add <path> <branch>` for an existing branch. */
  addWorktree(path: string, branch: string): Promise<void>;

  /**
   * `git worktree add -b <branch> <path> <base>` — creates the branch and the
   * worktree in one operation, so there's no half-done state to clean up.
   */
  addWorktreeWithNewBranch(
    path: string,
    branch: string,
    base: string,
  ): Promise<void>;
};

/**
 * Per-side cap for the diff viewer. Monaco diffs on the main thread, so a
 * multi-megabyte file locks the tab for seconds. Matches the file preview's
 * own limit so the two viewers refuse the same files.
 */
export const MAX_DIFF_BYTES = 2 * 1024 * 1024;

/**
 * `maxBuffer` for a blob read. One byte over the display cap, so an oversized
 * blob still *reads* (and is reported as too large) instead of failing as an
 * opaque ENOBUFS that would be indistinguishable from a missing object.
 */
const BLOB_READ_LIMIT_BYTES = MAX_DIFF_BYTES + 1;

/**
 * Sentinel for "this side exists but is too big to send". A distinct object so
 * it can never be confused with a genuinely empty blob.
 */
const OVERSIZED: Buffer = Buffer.alloc(0);

/** How much of a blob is sampled for the binary check. */
const BINARY_SNIFF_BYTES = 8000;

/**
 * Git's own heuristic: a NUL byte in the first few KiB means binary. Extension
 * lists miss unknown formats and misfire on text files that happen to end in
 * `.doc`, so the bytes decide.
 */
function looksBinary(buffer: Buffer | null): boolean {
  if (!buffer || buffer === OVERSIZED) return false;
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Decodes a blob for the diff editor, normalising line endings.
 *
 * The normalisation is load-bearing on Windows: with `core.autocrlf=true` the
 * index holds LF and the working copy holds CRLF, so an un-normalised diff
 * marks *every single line* as changed.
 */
function toDiffText(buffer: Buffer | null): string {
  if (!buffer || buffer === OVERSIZED) return "";
  return buffer.toString("utf8").replace(/\r\n/g, "\n");
}

/**
 * Creates a small git wrapper bound to a directory. The directory may use `~`
 * and relative segments; it is resolved to an absolute path.
 */
export function createGitCli(directory: string): Git {
  const cwd = resolvePath(directory);

  async function git(...args: string[]): Promise<string> {
    // execFile (no shell) so paths/branch names can't be interpreted as commands.
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd,
        windowsHide: true,
        // generous: `ls-files` on a large monorepo can emit several MB of paths.
        // this is only a cap, nothing is preallocated.
        maxBuffer: 32 * 1024 * 1024,
      });
      return stdout.trim();
    } catch (error) {
      const stderr =
        typeof (error as { stderr?: unknown })?.stderr === "string"
          ? ((error as { stderr: string }).stderr as string).trim()
          : "";
      throw new GitCommandError(
        stderr || (error as Error)?.message || `git ${args[0]} failed`,
        args,
      );
    }
  }

  /**
   * Same as {@link git} but returns stdout verbatim. Required for `-z` output:
   * `git status --porcelain` encodes "unmodified" as a leading space, which
   * `trim()` would silently eat and shift every status code by one column.
   */
  async function gitRaw(...args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const stderr =
        typeof (error as { stderr?: unknown })?.stderr === "string"
          ? ((error as { stderr: string }).stderr as string).trim()
          : "";
      throw new GitCommandError(
        stderr || (error as Error)?.message || `git ${args[0]} failed`,
        args,
      );
    }
  }

  async function isGitRepo(): Promise<boolean> {
    try {
      return (await git("rev-parse", "--is-inside-work-tree")) === "true";
    } catch {
      // non-zero exit (not a repo), or the directory doesn't exist
      return false;
    }
  }

  async function getCurrentBranchName(): Promise<string | null> {
    try {
      // empty output means detached HEAD
      const branch = await git("branch", "--show-current");
      return branch === "" ? null : branch;
    } catch {
      return null;
    }
  }

  async function isWorktree(): Promise<boolean> {
    try {
      // in a linked worktree these differ: --git-dir points at
      // <main>/.git/worktrees/<name>, --git-common-dir at <main>/.git
      const [gitDir, commonDir] = await Promise.all([
        git("rev-parse", "--absolute-git-dir"),
        git("rev-parse", "--path-format=absolute", "--git-common-dir"),
      ]);
      return gitDir !== commonDir;
    } catch {
      // non-zero exit (not a repo), or the directory doesn't exist
      return false;
    }
  }

  async function listBranches(): Promise<string[]> {
    try {
      const stdout = await git("branch", "--format=%(refname:short)");
      return stdout.split("\n").filter((line) => line !== "");
    } catch {
      // a repo with no commits yet has no branches to list
      return [];
    }
  }

  async function listFiles(): Promise<string[] | null> {
    try {
      const stdout = await git(
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
      );
      return stdout.split("\n").filter((line) => line !== "");
    } catch (error) {
      // not a repo, git missing, or stdout blew past maxBuffer -- the caller
      // has a filesystem fallback, so this is a warning and not an error
      console.warn(`git ls-files failed in ${cwd}`, error);
      return null;
    }
  }

  async function getMainBranch(): Promise<string> {
    try {
      // e.g. "origin/main" -> "main"
      const originHead = await git(
        "symbolic-ref",
        "--short",
        "refs/remotes/origin/HEAD",
      );
      const branch = originHead.replace(/^origin\//, "");
      if (branch) return branch;
    } catch {
      // no remote, or origin/HEAD was never set -> fall through
    }

    const branches = await listBranches();
    if (branches.includes("main")) return "main";
    if (branches.includes("master")) return "master";

    return (await getCurrentBranchName()) ?? "main";
  }

  async function listWorktrees(): Promise<WorktreeEntry[]> {
    try {
      const stdout = await git("worktree", "list", "--porcelain");
      const entries: WorktreeEntry[] = [];
      let current: WorktreeEntry | null = null;

      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("worktree ")) {
          // records are separated by blank lines; a new header closes the previous one
          if (current) entries.push(current);
          current = { path: trimmed.slice("worktree ".length), branch: null };
        } else if (trimmed.startsWith("branch ") && current) {
          current.branch = trimmed
            .slice("branch ".length)
            .replace(/^refs\/heads\//, "");
        }
      }
      if (current) entries.push(current);

      return entries;
    } catch {
      return [];
    }
  }

  async function getRepoRoot(): Promise<string | null> {
    try {
      // already trimmed of the trailing newline by `git()`
      return (await git("rev-parse", "--show-toplevel")) || null;
    } catch {
      // non-zero exit (not a repo), or the directory doesn't exist
      return null;
    }
  }

  async function status(): Promise<GitFileChange[]> {
    let stdout: string;
    try {
      stdout = await gitRaw(
        // `--no-optional-locks` keeps a background refresh from fighting a
        // concurrent `git commit` over index.lock
        "--no-optional-locks",
        "status",
        "--porcelain",
        // NUL-delimited: paths are emitted verbatim, so spaces, quotes and
        // non-ASCII characters need no unescaping
        "-z",
        // list untracked files individually; the default collapses an untracked
        // directory into a single `dir/` entry, which a file tree can't render
        "--untracked-files=all",
      );
    } catch {
      // not a repo, or the directory is gone -- the panel renders an empty state
      return [];
    }

    return parsePorcelainStatus(stdout);
  }

  async function refExists(ref: string): Promise<boolean> {
    try {
      await git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Raw bytes of the object at `revSpec` (`HEAD:a/b.ts`, `:a/b.ts`), or `null`
   * when it doesn't exist.
   *
   * `cat-file blob` rather than `git show`: `show` runs the blob through
   * textconv filters and pretty-printing, which would silently rewrite the
   * content we are about to diff.
   */
  async function readBlob(revSpec: string): Promise<Buffer | null> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["cat-file", "blob", revSpec],
        {
          cwd,
          windowsHide: true,
          // Buffer, not a string: the blob may be binary, and decoding it as
          // utf-8 first would destroy the bytes the NUL check looks for
          encoding: "buffer",
          maxBuffer: BLOB_READ_LIMIT_BYTES,
        },
      );
      return stdout as unknown as Buffer;
    } catch (error) {
      // blowing past maxBuffer is "too big to show", not "doesn't exist" --
      // conflating the two would render a 5MB file as one giant addition
      if ((error as NodeJS.ErrnoException)?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return OVERSIZED;
      }
      // no such blob (untracked/added file, missing HEAD in a fresh repo), or
      // the object is a tree/submodule -- all render as "nothing on this side"
      return null;
    }
  }

  /** Raw bytes of a repo-relative path on disk, or `null` when it's gone. */
  async function readWorktreeFile(
    relativePath: string,
  ): Promise<Buffer | null> {
    // git always reports POSIX separators; join() gives us the native path
    const absolute = path.resolve(cwd, ...relativePath.split("/"));

    // a `..` segment in a status path should be impossible, but the check is
    // free and keeps a malformed request from reading outside the repo
    const relative = path.relative(cwd, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

    try {
      const stats = await fs.stat(absolute);
      // a directory or a symlink-to-directory has no contents to diff
      if (!stats.isFile()) return null;
      if (stats.size > MAX_DIFF_BYTES) return OVERSIZED;
      return await fs.readFile(absolute);
    } catch {
      // deleted, or unreadable
      return null;
    }
  }

  async function diff({
    path: filePath,
    originalPath = null,
    side,
  }: {
    path: string;
    originalPath?: string | null;
    side: GitDiffSide;
  }): Promise<GitDiffContent> {
    // the "before" of a rename lives under the old name in HEAD, so diffing
    // the new name against HEAD would show the whole file as added
    const beforePath = originalPath ?? filePath;

    const [before, after] =
      side === "staged"
        ? await Promise.all([
            readBlob(`HEAD:${beforePath}`),
            // `:<path>` is stage 0 of the index -- what a commit would write
            readBlob(`:${filePath}`),
          ])
        : await Promise.all([
            readBlob(`:${beforePath}`),
            readWorktreeFile(filePath),
          ]);

    const isTooLarge =
      before === OVERSIZED ||
      after === OVERSIZED ||
      (before?.byteLength ?? 0) > MAX_DIFF_BYTES ||
      (after?.byteLength ?? 0) > MAX_DIFF_BYTES;

    const isBinary =
      !isTooLarge && (looksBinary(before) || looksBinary(after));

    const base = { path: filePath, originalPath, side };

    // the texts are dropped rather than truncated: half a file diffed against
    // a whole one produces a wall of fake deletions at the bottom
    if (isTooLarge || isBinary) {
      return { ...base, original: "", modified: "", isBinary, isTooLarge };
    }

    return {
      ...base,
      original: toDiffText(before),
      modified: toDiffText(after),
      isBinary: false,
      isTooLarge: false,
    };
  }

  async function stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    // `--` terminates the option list so a path beginning with `-` can't be
    // read as a flag
    await git("add", "-A", "--", ...paths);
  }

  async function unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await git("restore", "--staged", "--", ...paths);
  }

  async function restoreWorktree(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await git("restore", "--", ...paths);
  }

  async function removeUntracked(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    // no `-x`: ignored files stay put. `-f` is required because clean refuses
    // to delete anything without it.
    await git("clean", "-f", "-d", "--", ...paths);

    // `git clean` exits 0 whether or not it removed anything. A directory
    // holding its own `.git` -- a cloned dependency, a worktree, a vendored
    // repo -- is skipped unless `-ff` is passed, and skipped *silently*. That
    // is a deliberate safety valve on git's part (`-ff` would recursively
    // delete a repository with its own unpushed history), so this reports the
    // refusal instead of escalating to `-ff` behind the user's back.
    const survivors = (
      await Promise.all(
        paths.map(async (candidate) =>
          (await pathKind(candidate)) === "missing" ? null : candidate,
        ),
      )
    ).filter((candidate): candidate is string => candidate !== null);

    if (survivors.length === 0) return;

    const nested = (
      await Promise.all(
        survivors.map(async (candidate) =>
          (await pathKind(`${candidate}/.git`)) === "missing" ? null : candidate,
        ),
      )
    ).filter((candidate): candidate is string => candidate !== null);

    throw new GitCommandError(
      nested.length > 0
        ? `${nested.join(", ")} contains its own git repository, so git refused to delete it. Remove it yourself if that's really what you want.`
        : `git did not delete ${survivors.join(", ")}`,
      ["clean"],
    );
  }

  /** Whether a repo-relative path is still on disk. Never throws. */
  async function pathKind(
    relativePath: string,
  ): Promise<"present" | "missing"> {
    // git reports untracked directories with a trailing slash; `path.resolve`
    // handles that, but the empty segment it leaves must be dropped first
    const absolute = path.resolve(
      cwd,
      ...relativePath.split("/").filter(Boolean),
    );
    try {
      // lstat, not stat: a dangling symlink still occupies the path
      await fs.lstat(absolute);
      return "present";
    } catch {
      return "missing";
    }
  }

  async function commit(message: string): Promise<void> {
    // the message is a separate argv entry (execFile, no shell), so quotes,
    // newlines and `$` in it are inert
    await git("commit", "-m", message);
  }

  async function hasUpstream(): Promise<boolean> {
    try {
      await git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
      return true;
    } catch {
      // no upstream configured -- the only reason this resolves nothing on a
      // repo we've already verified
      return false;
    }
  }

  async function push(): Promise<void> {
    // asked up front rather than inferred from a failed push: git's "no
    // upstream" wording is localised and version-dependent, so retrying on
    // stderr text would silently mis-handle a genuine rejection
    if (await hasUpstream()) {
      await git("push");
      return;
    }

    const branch = await getCurrentBranchName();
    if (!branch) {
      throw new GitCommandError(
        "Cannot push a detached HEAD: check out a branch first",
        ["push"],
      );
    }

    await git("push", "--set-upstream", "origin", branch);
  }

  async function checkout(branch: string): Promise<void> {
    await git("checkout", branch);
  }

  async function checkoutNewBranch(
    branch: string,
    base: string,
  ): Promise<void> {
    await git("checkout", "-b", branch, base);
  }

  async function addWorktree(path: string, branch: string): Promise<void> {
    await git("worktree", "add", path, branch);
  }

  async function addWorktreeWithNewBranch(
    path: string,
    branch: string,
    base: string,
  ): Promise<void> {
    await git("worktree", "add", "-b", branch, path, base);
  }

  return {
    directory: cwd,
    isGitRepo,
    getCurrentBranchName,
    isWorktree,
    listBranches,
    listFiles,
    getMainBranch,
    getRepoRoot,
    status,
    listWorktrees,
    refExists,
    diff,
    stage,
    unstage,
    restoreWorktree,
    removeUntracked,
    commit,
    push,
    checkout,
    checkoutNewBranch,
    addWorktree,
    addWorktreeWithNewBranch,
  };
}

/** Status characters that are followed by a second NUL chunk holding the old path. */
const PATH_PAIR_CODES = new Set(["R", "C"]);

/**
 * Parses `git status --porcelain -z` output.
 *
 * Each record is `XY<space><path>\0`, where `X` is the index status and `Y` the
 * worktree status. Renames and copies emit a *second* chunk with the original
 * path, so the reader can't simply iterate chunk-by-chunk.
 *
 * Exported for testing.
 */
export function parsePorcelainStatus(stdout: string): GitFileChange[] {
  const chunks = stdout.split("\0");
  const changes: GitFileChange[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // the output ends with a trailing NUL, so the final chunk is always empty.
    // a record is at minimum "XY " plus one path character.
    if (!chunk || chunk.length < 4) continue;

    const staged = chunk[0] as GitStatusCode;
    const unstaged = chunk[1] as GitStatusCode;
    const path = chunk.slice(3);

    // renames and copies can appear on either side ("R " when staged, "RM" when
    // the renamed file was then modified), and each consumes one extra chunk
    let originalPath: string | null = null;
    if (PATH_PAIR_CODES.has(staged) || PATH_PAIR_CODES.has(unstaged)) {
      originalPath = chunks[++i] ?? null;
    }

    changes.push({ path, staged, unstaged, originalPath });
  }

  return changes;
}

/**
 * The single status we render for a file. Git tracks two (staged + unstaged);
 * this collapses them for display, preferring the worktree side because that's
 * the state on disk that the user is looking at.
 */
/**
 * Which of git's two status columns a tree was built from. The same file can
 * appear in both -- `AM` is an addition on the staged side and a modification
 * on the unstaged side -- so the side determines which letter is shown.
 */
export type GitChangeSide = "staged" | "unstaged";

export type EffectiveStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted"
  | "typeChanged"
  | "ignored";

export type GitTreeFile = {
  kind: "file";
  /** repo-root-relative path */
  path: string;
  /** trailing path segment, i.e. what's rendered */
  name: string;
  change: GitFileChange;
  /** derived from the column matching the tree's {@link GitChangeSide} */
  status: EffectiveStatus;
};

export type GitTreeDirectory = {
  kind: "directory";
  path: string;
  name: string;
  children: GitTreeNode[];
  /** number of changed files anywhere beneath this directory */
  fileCount: number;
  /**
   * The shared status of every file beneath this directory, or `null` when they
   * differ. Lets the row show `U` for a wholly-untracked folder while a mixed
   * folder falls back to its file count.
   */
  status: EffectiveStatus | null;
};

export type GitTreeNode = GitTreeFile | GitTreeDirectory;

const STATUS_BY_CODE: Record<string, EffectiveStatus> = {
  M: "modified",
  T: "typeChanged",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
  "?": "untracked",
  "!": "ignored",
};

/**
 * The status characters that mark an unmerged path. Both columns are
 * meaningful for these, so they belong to neither the staged nor the unstaged
 * list -- they get their own section.
 *
 * @see https://git-scm.com/docs/git-status#_short_format
 */
const UNMERGED_PAIRS = new Set([
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU",
]);

/** Whether this change is a merge conflict rather than an ordinary edit. */
export function isConflicted(change: GitFileChange): boolean {
  return UNMERGED_PAIRS.has(`${change.staged}${change.unstaged}`);
}

/**
 * Reads one of git's two status columns as a display status.
 *
 * Untracked files (`??`) are reported as untracked from either side; they only
 * ever appear in the unstaged list.
 */
export function toEffectiveStatus(
  change: GitFileChange,
  side: GitChangeSide,
): EffectiveStatus {
  if (isConflicted(change)) return "conflicted";
  if (change.staged === "?" || change.unstaged === "?") return "untracked";

  const code: GitStatusCode =
    side === "staged" ? change.staged : change.unstaged;
  return STATUS_BY_CODE[code] ?? "modified";
}

export type GitChangeGroups = {
  /** files with changes in the index */
  staged: GitTreeNode[];
  /** files with changes in the working tree, including untracked ones */
  unstaged: GitTreeNode[];
  /** unmerged paths; empty unless a merge or rebase is in progress */
  conflicted: GitTreeNode[];
};

/**
 * Splits a flat status list into the three trees the panel renders.
 *
 * A partially staged file (`AM`: staged as new, then edited again) deliberately
 * appears in *both* the staged and unstaged trees, matching how VS Code lists
 * it -- it really does have changes on both sides, and each tree labels it with
 * its own column.
 */
export function groupGitChanges(files: GitFileChange[]): GitChangeGroups {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const conflicted: GitFileChange[] = [];

  for (const change of files) {
    if (isConflicted(change)) {
      conflicted.push(change);
      continue;
    }

    // untracked files have never been staged, so they only belong below
    if (change.staged === "?" || change.unstaged === "?") {
      unstaged.push(change);
      continue;
    }

    if (change.staged !== " ") staged.push(change);
    if (change.unstaged !== " ") unstaged.push(change);
  }

  return {
    staged: buildGitTree(staged, "staged"),
    unstaged: buildGitTree(unstaged, "unstaged"),
    // the side is irrelevant here; conflicts resolve to "conflicted" either way
    conflicted: buildGitTree(conflicted, "unstaged"),
  };
}

type MutableDirectory = {
  kind: "directory";
  path: string;
  name: string;
  childrenByName: Map<string, MutableDirectory | GitTreeFile>;
};

function createDirectory(path: string, name: string): MutableDirectory {
  return { kind: "directory", path, name, childrenByName: new Map() };
}

/**
 * Builds a directory tree from git's flat, repo-root-relative path list.
 *
 * Single-child directory chains are flattened into one node (`app/routes/git`
 * rather than three nesting levels), which is how GitHub and VS Code render
 * change sets and keeps deep monorepo paths readable.
 */
export function buildGitTree(
  files: GitFileChange[],
  side: GitChangeSide,
): GitTreeNode[] {
  const root = createDirectory("", "");

  for (const change of files) {
    // git always emits POSIX separators, even on Windows
    const segments = change.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!;
      const path = cursor.path ? `${cursor.path}/${name}` : name;
      const existing = cursor.childrenByName.get(name);

      // a path can only be a file or a directory, never both, so an existing
      // entry here is always a directory
      if (existing && existing.kind === "directory") {
        cursor = existing;
      } else {
        const created = createDirectory(path, name);
        cursor.childrenByName.set(name, created);
        cursor = created;
      }
    }

    const name = segments[segments.length - 1]!;
    cursor.childrenByName.set(name, {
      kind: "file",
      path: change.path,
      name,
      change,
      status: toEffectiveStatus(change, side),
    });
  }

  return finalize(root).children;
}

/**
 * Converts the mutable builder tree into the rendered shape: sorts each level,
 * flattens single-child directory chains, and rolls counts and statuses upward.
 */
function finalize(directory: MutableDirectory): GitTreeDirectory {
  const children: GitTreeNode[] = [];
  let fileCount = 0;
  let status: EffectiveStatus | null = null;
  let isFirstStatus = true;

  const entries = [...directory.childrenByName.values()].sort(compareEntries);

  for (const entry of entries) {
    const node = entry.kind === "directory" ? finalize(entry) : entry;
    children.push(node);

    fileCount += node.kind === "directory" ? node.fileCount : 1;

    if (isFirstStatus) {
      status = node.status;
      isFirstStatus = false;
    } else if (status !== node.status) {
      status = null;
    }
  }

  // collapse `a` -> `a/b` into a single `a/b` row, but never collapse into a
  // file: `src` containing only `src/index.ts` must stay two rows so the file's
  // own status badge and click target remain distinct.
  // the synthetic root (empty path) is excluded -- collapsing it would discard
  // a real directory level from the output entirely
  const [onlyChild] = children;
  if (
    directory.path !== "" &&
    children.length === 1 &&
    onlyChild?.kind === "directory"
  ) {
    return { ...onlyChild, name: `${directory.name}/${onlyChild.name}` };
  }

  return {
    kind: "directory",
    path: directory.path,
    name: directory.name,
    children,
    fileCount,
    status,
  };
}

/** Directories first, then case-insensitive alphabetical -- standard file-tree order. */
function compareEntries(
  a: MutableDirectory | GitTreeFile,
  b: MutableDirectory | GitTreeFile,
): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * The git client for `directory`, or `null` when the path doesn't exist, is a
 * file, or sits outside any repo -- the three cases `/git/branch` must degrade
 * on rather than error. Routes that have no degraded state turn the `null` into
 * a failure themselves; deciding on a status code is not this function's job.
 *
 * Callers that also need the repo root call `getRepoRoot()` on the result.
 */
export async function findRepo(directory: string): Promise<Git | null> {
  const git = createGitCli(directory);
  return (await git.isGitRepo()) ? git : null;
}
