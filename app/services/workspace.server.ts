import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorktreePath, type Worktree } from "~/lib/worktree-path";
import type {
  CreateSessionInput,
  CreateSessionResult,
  WorkspaceCreated,
} from "~/routes/home/home.types";
import { resolvePath } from "~/services/fs.server";
import {
  createGitCli,
  GitCommandError,
  type Git,
  type WorktreeEntry,
} from "~/services/git.server";

function fail(
  formErrors: string[],
  fieldErrors: Record<string, string[]> = {},
): CreateSessionResult {
  return { ok: false, formErrors, fieldErrors };
}

/**
 * Path equality that tolerates git's posix-style output on windows
 * (`C:/Users/...` vs `C:\Users\...`) and windows' case-insensitivity.
 */
function samePath(a: string, b: string) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

type PathState =
  | { kind: "missing" }
  | { kind: "empty-dir" }
  | { kind: "non-empty-dir" }
  | { kind: "file" };

async function inspectPath(target: string): Promise<PathState> {
  try {
    const stats = await fs.stat(target);
    if (!stats.isDirectory()) return { kind: "file" };
    const entries = await fs.readdir(target);
    return entries.length === 0
      ? { kind: "empty-dir" }
      : { kind: "non-empty-dir" };
  } catch {
    return { kind: "missing" };
  }
}

/**
 * The base commit a new branch is created from. The submitted `branchFrom` is
 * only a hint: it comes from a client that may be looking at stale git state,
 * so anything that doesn't resolve falls back to the current branch, then the
 * repo's main branch.
 */
async function resolveBase(
  git: Git,
  branchFrom: string | undefined,
  currentBranch: string | null,
): Promise<string | null> {
  const candidates = [
    branchFrom?.trim(),
    currentBranch ?? undefined,
    await git.getMainBranch(),
    "HEAD",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await git.refExists(candidate)) return candidate;
  }

  return null;
}

/** the worktree (if any) that currently owns `branch` */
function worktreeForBranch(worktrees: WorktreeEntry[], branch: string) {
  return worktrees.find((entry) => entry.branch === branch);
}

/**
 * Turns a submitted prompt payload into a folder the agent can actually run in:
 * checking out branches, creating branches, and adding worktrees as needed.
 *
 * Git state is re-read here rather than trusted from the request, so the
 * "create a new branch" intent is *derived* (submitted branch is absent from
 * the repo's branch list) instead of being asserted by the client.
 *
 * Failures are returned, not thrown, and nothing is rolled back: a worktree
 * that was created before a later step failed is left on disk, because
 * re-submitting the same payload reuses it instead of erroring.
 */
export async function prepareWorkspace(
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  const folderPath = resolvePath(input.folderPath);

  const folderState = await inspectPath(folderPath);
  if (folderState.kind === "missing" || folderState.kind === "file") {
    return fail([], {
      folderPath: [`${input.folderPath} is not a folder.`],
    });
  }

  const git = createGitCli(folderPath);
  const isWorktreeIntent = input.worktreeType === "worktree";

  if (!(await git.isGitRepo())) {
    if (isWorktreeIntent) {
      return fail([
        `${input.folderPath} isn't a git repository, so a worktree can't be created for it.`,
      ]);
    }
    // nothing to prepare: the agent just runs in the folder
    return { ok: true, cwd: folderPath, branch: null, created: {} };
  }

  const [currentBranch, branches, worktrees] = await Promise.all([
    git.getCurrentBranchName(),
    git.listBranches(),
    git.listWorktrees(),
  ]);

  const branch = input.branch?.trim() ?? "";
  const created: WorkspaceCreated = {};

  if (!isWorktreeIntent) {
    // ---- run in the selected folder -------------------------------------
    if (!branch || branch === currentBranch) {
      return { ok: true, cwd: folderPath, branch: currentBranch, created };
    }

    // git only allows one worktree per branch, and its own error for this is
    // raised too late to be useful, so it's checked up front
    const owner = worktreeForBranch(worktrees, branch);
    if (owner && !samePath(owner.path, folderPath)) {
      return fail([
        `"${branch}" is already checked out at ${owner.path}. Switch to that folder, or pick another branch.`,
      ]);
    }

    try {
      if (branches.includes(branch)) {
        // no dirty-tree preflight on purpose: git's own behaviour (carry the
        // changes over, or refuse) is the behaviour we want to expose
        await git.checkout(branch);
      } else {
        const base = await resolveBase(git, input.branchFrom, currentBranch);
        if (!base) {
          return fail([
            `Couldn't find a commit to create "${branch}" from. Make a first commit in this repository.`,
          ]);
        }
        await git.checkoutNewBranch(branch, base);
        created.branch = branch;
      }
    } catch (error) {
      return fail([gitMessage(error)]);
    }

    return { ok: true, cwd: folderPath, branch, created };
  }

  // ---- run in a worktree -------------------------------------------------
  if (!branch) {
    return fail([], { branch: ["Select a branch for the worktree."] });
  }

  // the branch already lives in a worktree: that folder *is* the workspace the
  // user asked for, so use it instead of failing on git's one-worktree rule
  const existing = worktreeForBranch(worktrees, branch);
  if (existing) {
    return { ok: true, cwd: path.resolve(existing.path), branch, created };
  }

  const worktree: Worktree =
    input.worktreeSource === "manual"
      ? { type: "worktree", source: "manual", path: input.worktreePath ?? "" }
      : { type: "worktree", source: "auto" };

  // recomputed with the same helper the picker previewed with, so the folder
  // that appears is the folder the user was shown
  const targetInput = resolveWorktreePath(worktree, folderPath, branch);
  if (!targetInput.trim()) {
    return fail([], { worktreePath: ["Enter a folder for the worktree."] });
  }
  const target = resolvePath(targetInput);

  if (samePath(target, folderPath)) {
    return fail([
      `The worktree folder is the folder you're already in (${target}). Pick a different folder.`,
    ]);
  }

  const targetState = await inspectPath(target);
  if (targetState.kind === "file") {
    return fail([`${target} is a file, not a folder.`]);
  }
  if (targetState.kind === "non-empty-dir") {
    // `existing` was null, so if this path is a worktree it's on another branch
    const occupant = worktrees.find((entry) => samePath(entry.path, target));
    if (occupant) {
      return fail([
        `${target} is already a worktree on branch "${occupant.branch ?? "a detached HEAD"}". Pick a different folder.`,
      ]);
    }
    return fail([`${target} already exists and isn't empty.`]);
  }

  try {
    if (branches.includes(branch)) {
      await git.addWorktree(target, branch);
    } else {
      const base = await resolveBase(git, input.branchFrom, currentBranch);
      if (!base) {
        return fail([
          `Couldn't find a commit to create "${branch}" from. Make a first commit in this repository.`,
        ]);
      }
      await git.addWorktreeWithNewBranch(target, branch, base);
      created.branch = branch;
    }
    created.worktree = target;
  } catch (error) {
    return fail([gitMessage(error)]);
  }

  return { ok: true, cwd: target, branch, created };
}

/** git's stderr verbatim, with a generic fallback for non-git failures */
function gitMessage(error: unknown) {
  if (error instanceof GitCommandError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong preparing the workspace.";
}
