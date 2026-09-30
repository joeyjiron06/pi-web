import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { GitBranchIcon, PlusIcon } from "lucide-react";
import { getModelDefaults, getModels } from "~/services/models.server";
import { useCallback, useEffect, useMemo, useState } from "react";
import BranchPicker from "~/components/branch-picker";
import CreateBranchDialog from "~/components/branch-create-dialog";
import { FileDropOverlay } from "~/components/file-drop-overlay";
import FolderPicker from "~/components/folder-picker";
import PromptInput from "~/components/prompt-input";
import { CommandGroup, CommandItem } from "~/components/ui/command";
import { toast } from "~/components/ui/toast";
import WorktreePicker from "~/components/worktree-picker";
import { useAttachments } from "~/hooks/use-attachments";
import { useFileDrop } from "~/hooks/use-file-drop";
import { ATTACHMENT_FIELD_NAME } from "~/lib/attachments";
import type { Worktree } from "~/lib/worktree-path";
import { parseModelRef } from "~/lib/model-ref";
import type { FolderItem } from "~/routes/fs/fs.types";
import type { GitBranchResult } from "~/routes/git/branch";
import {
  data,
  Form,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import { homeDirectory, resolvePath, toFolderItem } from "~/services/fs.server";
import { createSessionSchema, type CreateSessionResult } from "./home.types";
import { prepareWorkspace } from "~/services/workspace.server";
import { addProjectPath, getProjects } from "~/services/projects.server";
import { prepareAttachments } from "~/services/attachments.server";
import type { Route } from "./+types/home";
import { createSession, sessionPrompt } from "~/services/sessions.server";

export function loader({ request }: Route.LoaderArgs) {
  const modelDefaults = getModelDefaults();
  // the sidebar links to `/?cwd=<path>` to start a session in a project
  const cwd = new URL(request.url).searchParams.get("cwd")?.trim();

  return data({
    defaultDirectory: cwd ? toFolderItem(resolvePath(cwd)) : homeDirectory(),
    // stored name wins so a renamed/aliased project keeps its label
    recentFolders: getProjects().map((project) =>
      toFolderItem(project.path, project.name),
    ),
    // awaited plain values: they seed useState on the first render, so unlike
    // `models` they can't be streamed in later.
    defaultModelRef: modelDefaults.modelRef ?? "",
    defaultThinkingLevel: modelDefaults.thinkingLevel ?? "medium",
    // deliberately not awaited -- it streams in and only suspends the pickers
    models: getModels(),
  });
}

export async function action({ request }: Route.ActionArgs) {
  const parsed = createSessionSchema.safeParse(await request.formData());

  if (!parsed.success) {
    const flattened = z.flattenError(parsed.error);
    return data<CreateSessionResult>(
      {
        ok: false,
        formErrors: flattened.formErrors,
        fieldErrors: flattened.fieldErrors as Record<string, string[]>,
      },
      { status: 400 },
    );
  }

  const result = await prepareWorkspace(parsed.data);

  if (!result.ok) {
    return data<CreateSessionResult>(result, { status: 400 });
  }

  // `result.cwd` is *the folder the session will run in* -- the selected folder
  // for a plain run, or the worktree prepareWorkspace created/reused when the
  // user picked one. Re-deriving it from `folderPath` here silently ran the
  // agent in the main checkout instead of the worktree.
  const projectPath = result.cwd;
  addProjectPath(projectPath);

  // the schema already rejects a malformed ref, so this can't be null here --
  // `?? undefined` only exists to satisfy the type without a non-null assertion
  const model = parseModelRef(parsed.data.modelRef) ?? undefined;

  const session = await createSession({
    cwd: projectPath,
    thinkingLevel: parsed.data.thinkingLevel,
    model,
  });

  // After createSession, because the attachments are written under the session
  // id and that id doesn't exist until now.
  const prepared = await prepareAttachments(
    parsed.data[ATTACHMENT_FIELD_NAME],
    session.sessionId,
  );

  if (prepared.errors.length > 0) {
    // Non-fatal: the session is already created and the prompt still has value
    // without the attachment, so this is logged rather than thrown away.
    console.error("attachment errors for", session.sessionId, prepared.errors);
  }

  const promptText = prepared.fileReferencesText
    ? `${parsed.data.prompt}\n\n${prepared.fileReferencesText}`
    : parsed.data.prompt;

  const outcome = await sessionPrompt(session.sessionId, promptText, {
    images: prepared.images,
  });

  // A rejection here happens before the agent ever starts, so nothing about it
  // reaches the event stream. Redirecting anyway would drop the user on an
  // empty transcript with no explanation, so the error is reported instead.
  // The session itself stays created and is reachable from the sidebar.
  if (!outcome.accepted) {
    return data<CreateSessionResult>(
      { ok: false, formErrors: [outcome.error], fieldErrors: {} },
      { status: 400 },
    );
  }

  throw redirect(`/session/${session.sessionId}`);
}

export default function Home() {
  const {
    defaultDirectory,
    recentFolders,
    models,
    defaultModelRef,
    defaultThinkingLevel,
  } = useLoaderData<typeof loader>();

  const [userPrompt, setUserPrompt] = useState<string>("");
  const [modelRef, setModelRef] = useState<string>(defaultModelRef);
  const [thinkingLevel, setThinkingLevel] =
    useState<ThinkingLevel>(defaultThinkingLevel);

  const [branch, setBranch] = useState<string>("");
  const [worktree, setWorktree] = useState<Worktree>({ type: "local" });
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [newBranch, setNewBranch] = useState<string>("");
  const [branchFrom, setBranchFrom] = useState<string>("");
  // the branch created via the dialog, shown in its own section in the picker.
  // creating again replaces it rather than accumulating a list.
  const [createdBranch, setCreatedBranch] = useState<string>("");

  // the folder is owned by the url (`/?cwd=<path>` from the sidebar) and only
  // overridden by a manual pick. the override records which defaultDirectory it
  // was made against, so a later ?cwd= navigation -- which re-renders this route
  // rather than remounting it -- wins without needing a sync effect.
  const [pickedFolder, setPickedFolder] = useState<{
    base: string;
    folder: FolderItem;
  } | null>(null);

  const folder = useMemo(
    () =>
      pickedFolder?.base === defaultDirectory.path
        ? pickedFolder.folder
        : defaultDirectory,
    [pickedFolder, defaultDirectory],
  );

  const branchFetcher = useFetcher<GitBranchResult>();
  const gitInfo = branchFetcher.data;

  const actionData = useActionData<typeof action>();
  const isBusy = useNavigation().state !== "idle";

  const { attachments, addFiles, removeAttachment } = useAttachments();
  const isDragging = useFileDrop(addFiles);

  // react router cancels superseded loads for a given fetcher, so rapid folder
  // switches can't leave us showing an older folder's branches
  useEffect(() => {
    if (!folder?.path) return;
    branchFetcher.load(
      `/git/branch?directory=${encodeURIComponent(folder.path)}`,
    );
    // branchFetcher is a new object every render; keying on the path is the intent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.path]);

  // adopt the repo's checked out branch whenever new git info arrives. done in an
  // effect (not in the folder handler) so the initial load is covered too.
  useEffect(() => {
    if (!gitInfo?.isGitRepo) return;
    const current = gitInfo.branchName ?? gitInfo.mainBranch;
    setBranch(current);
    setBranchFrom(current);
    setCreatedBranch("");
  }, [gitInfo]);

  // report the outcome. errors are persistent (timeout: 0) because they
  // describe repo state the user has to go and fix.
  useEffect(() => {
    const result = actionData;
    if (!result) return;

    if (!result.ok) {
      const messages = [
        ...result.formErrors,
        ...Object.values(result.fieldErrors).flat(),
      ];
      for (const message of messages) {
        toast.add({
          title: "Couldn't start",
          description: message,
          type: "error",
          timeout: 0,
        });
      }
      return;
    }
  }, [actionData]);

  const handleFolderChanged = useCallback(
    (next: FolderItem) => {
      setPickedFolder({ base: defaultDirectory.path, folder: next });
      // a manual worktree points into the *previous* project's parent, which is
      // meaningless now. auto re-derives itself, but reset both for consistency.
      setWorktree({ type: "local" });
    },
    [defaultDirectory.path],
  );

  const handleCreateBranchOpen = useCallback(() => {
    setBranchPickerOpen(false);
    setNewBranch("");
    setBranchFrom(branch);
    setCreateBranchOpen(true);
  }, [branch]);

  const handleCreateBranch = useCallback(() => {
    const name = newBranch.trim();
    setCreatedBranch(name);
    setBranch(name);
    setCreateBranchOpen(false);
  }, [newBranch]);

  const handleCreatedBranchSelected = useCallback(() => {
    setBranchPickerOpen(false);
    setBranch(createdBranch);
  }, [createdBranch]);

  const handlePromptChanged = useCallback((text: string) => {
    setUserPrompt(text);
  }, []);

  return (
    <div className="h-full">
        <FileDropOverlay isDragging={isDragging} />
        <div className="max-w-2xl flex flex-col items-center justify-center w-full h-full flex-1 mx-auto gap-6">
          <h1 className="text-6xl font-bold tracking-tight">Build Something</h1>{" "}
          <Form method="post" className="flex w-full flex-col" encType="multipart/form-data">
            {/* every other field is emitted by the control that owns it (see
                FolderPicker / BranchPicker / WorktreePicker / PromptInput).
                `branchFrom` has no owning control inside the form: it belongs to
                CreateBranchDialog, which renders outside it. */}
            <input type="hidden" name="branchFrom" value={branchFrom} />

            {/* a disabled fieldset natively disables every control inside it,
                which is also the double-submit guard: the git operations it
                triggers are not reversible.

                the hidden fields inside are disabled along with it, and disabled
                controls aren't submitted -- that's fine, because `isBusy` only
                becomes true *after* the submit event has already snapshotted the
                FormData, and the send button is disabled so there's no resubmit. */}
            <fieldset
              disabled={isBusy}
              className="flex w-full min-w-0 flex-col gap-2"
            >
              <div className="flex items-center gap-1 self-start">
                <FolderPicker
                  name="folderPath"
                  folder={folder}
                  recentFolders={recentFolders}
                  onFolderChanged={handleFolderChanged}
                />
                {branchFetcher.state === "idle" && gitInfo?.isGitRepo && (
                  <>
                    <BranchPicker
                      name="branch"
                      branches={gitInfo.branches}
                      branch={branch}
                      mainBranch={gitInfo.mainBranch}
                      onBranchChanged={setBranch}
                      open={branchPickerOpen}
                      onOpenChange={setBranchPickerOpen}
                      footer={
                        <CommandGroup>
                          <CommandItem
                            forceMount
                            value="create-and-checkout-new-branch"
                            onSelect={handleCreateBranchOpen}
                          >
                            <PlusIcon className="text-muted-foreground" />
                            <span className="truncate">
                              Create and checkout new branch
                            </span>
                          </CommandItem>
                        </CommandGroup>
                      }
                    >
                      {createdBranch && (
                        <CommandGroup heading="New Branch">
                          <CommandItem
                            value={createdBranch}
                            onSelect={handleCreatedBranchSelected}
                            data-checked={createdBranch === branch}
                          >
                            <GitBranchIcon className="text-muted-foreground" />
                            <span className="truncate" title={createdBranch}>
                              {createdBranch}
                            </span>
                          </CommandItem>
                        </CommandGroup>
                      )}
                    </BranchPicker>
                    <WorktreePicker
                      worktree={worktree}
                      onWorktreeChanged={setWorktree}
                      branch={branch}
                      projectPath={folder?.path}
                    />
                  </>
                )}
              </div>
              <PromptInput
                text={userPrompt}
                onTextChanged={handlePromptChanged}
                modelRef={modelRef}
                modelsPromise={models}
                onModelChanged={setModelRef}
                thinkingLevel={thinkingLevel}
                thinkingLevelChanged={setThinkingLevel}
                cwd={folder?.path ?? ""}
                isBusy={isBusy}
                attachments={attachments}
                onAttachmentRemove={removeAttachment}
                onFilesSelected={addFiles}
              />
            </fieldset>
          </Form>
          <CreateBranchDialog
            open={createBranchOpen}
            onOpenChange={setCreateBranchOpen}
            branches={gitInfo?.isGitRepo ? gitInfo.branches : []}
            branch={newBranch}
            onBranchChanged={setNewBranch}
            branchFrom={branchFrom}
            onBranchFromChanged={setBranchFrom}
            mainBranch={gitInfo?.isGitRepo ? gitInfo.mainBranch : undefined}
            onCreate={handleCreateBranch}
          />
        </div>
      </div>
  );
}
