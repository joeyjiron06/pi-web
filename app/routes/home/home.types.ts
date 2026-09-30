import { z } from "zod";
import { zfd } from "zod-form-data";
import { ATTACHMENT_FIELD_NAME } from "~/lib/attachments";
import { isModelRef } from "~/lib/model-ref";

export const THINKING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/**
 * `zfd.text()` maps an empty field to `undefined`, so a plain `.min(1)` never
 * runs and the user sees zod's "expected string, received undefined". Setting
 * `error` covers the missing case with the same message.
 */
const requiredText = (message: string) =>
  zfd.text(z.string({ error: message }).min(1, message));

/**
 * The payload the homepage submits when a user sends a prompt.
 *
 * Deliberately flat: `Worktree` is a discriminated union in the UI, but a
 * FormData body is a flat map, so it is split into `worktreeType` /
 * `worktreeSource` / `worktreePath` and re-assembled server side.
 *
 * There is no `createNewBranch` flag. Whether a branch needs creating is
 * *derived* on the server by comparing the submitted branch against the repo's
 * actual branch list, so a stale client can't ask us to create a branch that
 * already exists (or vice versa).
 */
export const createSessionSchema = zfd
  .formData({
    folderPath: requiredText("Select a folder"),
    prompt: requiredText("Enter a prompt"),

    // absent for non-git folders
    branch: zfd.text(z.string().optional()),
    // base for a branch that doesn't exist yet; ignored otherwise
    branchFrom: zfd.text(z.string().optional()),

    // the worktree picker is only rendered for git repos, so this field is
    // absent for a plain folder; "local" is the only meaningful value there.
    worktreeType: zfd.text(z.enum(["local", "worktree"]).default("local")),
    worktreeSource: zfd.text(z.enum(["auto", "manual"]).optional()),
    worktreePath: zfd.text(z.string().optional()),

    // carried through for the agent; not used to prepare the workspace yet.
    // skills stay embedded in the prompt string (`/skill:name ...`).
    //
    // a canonical `provider/id` ref (see `~/lib/model-ref`), not a bare id:
    // the id alone doesn't identify a model. the shape check also catches a
    // stale client that still posts a bare id, instead of that reaching
    // `createSession` and silently falling back to pi's own default model.
    modelRef: requiredText("Select a model").refine(isModelRef, {
      error: "Select a model",
    }),
    thinkingLevel: zfd.text(z.enum(THINKING_LEVELS)),

    /**
     * Files from the composer. Not `zfd.file()`: that helper rewrites a
     * zero-byte File to `undefined`, which then fails the array's element
     * check instead of simply being absent -- and an empty file input submits
     * exactly that. Empties are filtered here instead.
     */
    [ATTACHMENT_FIELD_NAME]: zfd
      .repeatable(z.array(z.instanceof(File)))
      .transform((files) => files.filter((file) => file.size > 0)),
  })
  .superRefine((value, ctx) => {
    if (value.worktreeType !== "worktree") return;

    if (!value.worktreeSource) {
      ctx.addIssue({
        code: "custom",
        path: ["worktreeSource"],
        message: "Missing worktree source",
      });
      return;
    }

    if (value.worktreeSource === "manual" && !value.worktreePath?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["worktreePath"],
        message: "Enter a folder for the worktree",
      });
    }
  });

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

/** what was actually created on disk, for reporting back to the user */
export type WorkspaceCreated = {
  /** a branch that did not exist before this submission */
  branch?: string;
  /** a worktree directory that did not exist before this submission */
  worktree?: string;
};

export type CreateSessionSuccess = {
  ok: true;
  /** the folder the session will run in */
  cwd: string;
  /** the branch checked out in `cwd`, or null for a non-repo / detached HEAD */
  branch: string | null;
  created: WorkspaceCreated;
};

export type CreateSessionFailure = {
  ok: false;
  /** messages that aren't tied to a single field (git failures, mostly) */
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
};

export type CreateSessionResult = CreateSessionSuccess | CreateSessionFailure;
