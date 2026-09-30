import slugify from "slugify";

/**
 * Where a session runs. A worktree is a *pending intent* until the session
 * starts — nothing exists on disk yet — so `auto` deliberately stores no path
 * and is re-derived from the current project + branch on every render.
 */
export type Worktree =
  | { type: "local" }
  | { type: "worktree"; source: "auto" }
  | { type: "worktree"; source: "manual"; path: string };

/** last path segment, tolerating both windows and posix separators */
export function displayPath(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

/** windows paths use `\`, everything else `/` */
function separatorFor(path: string) {
  return path.includes("\\") ? "\\" : "/";
}

/** drops the last segment: `/a/b/c` -> `/a/b`. empty when there's no parent */
export function parentOf(path: string) {
  const separator = separatorFor(path);
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = trimmed.lastIndexOf(separator);
  if (index <= 0) return "";
  return trimmed.slice(0, index);
}

export function joinPath(dir: string, name: string) {
  const separator = separatorFor(dir);
  return `${dir.replace(/[\\/]+$/, "")}${separator}${name}`;
}

/**
 * `fix/my-update` -> `fix-my-update`, safe to use as a folder name.
 *
 * slugify() *strips* `/`, `\`, `_` and `.` rather than replacing them
 * (`fix/my-update` would become `fixmy-update`), so separators are turned into
 * the replacement char up front.
 */
export function toFolderName(branch: string) {
  return slugify(branch.replace(/[/\\_.\s]+/g, "-"), {
    lower: true,
    strict: true,
  });
}

/**
 * Default worktree location: a sibling of the *selected* project folder, named
 * after the branch.
 *
 * Deliberately relative to the selected folder rather than the repo's main
 * worktree: picking a linked worktree and creating another one chains outward
 * from where you are. The consequence is that one branch can map to different
 * paths depending on the folder you started from, which is why occupied paths
 * are resolved by rule (reuse / reject) rather than assumed unique.
 */
export function siblingWorktreePath(projectPath: string, branch: string) {
  const name = toFolderName(branch) || "worktree";
  if (!projectPath) return "";
  const parent = parentOf(projectPath);
  return parent ? joinPath(parent, name) : name;
}

/**
 * The folder a session will actually run in.
 *
 * Shared by the picker (preview) and the server (execution) so that an `auto`
 * worktree always resolves to the exact path the user was shown.
 */
export function resolveWorktreePath(
  worktree: Worktree,
  projectPath: string,
  branch: string,
) {
  if (worktree.type === "local") return projectPath;
  if (worktree.source === "manual") return worktree.path;
  return siblingWorktreePath(projectPath, branch);
}
