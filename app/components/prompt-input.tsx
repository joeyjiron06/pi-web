import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import {
  ArrowUpIcon,
  PaperclipIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { ActionBar } from "./prompt-area/action-bar";
import { commandTrigger, mentionTrigger } from "./prompt-area/trigger-presets";
import {
  segmentsToPlainText,
  plainTextToSegments,
} from "./prompt-area/segment-helpers";
import { PromptArea } from "./prompt-area/prompt-area";
import {
  type PromptAreaFile,
  type PromptAreaHandle,
  type PromptAreaImage,
  type Segment,
  type SubmitModifiers,
  type TriggerSuggestion,
} from "./prompt-area/types";
import { ATTACHMENT_FIELD_NAME, type Attachment } from "~/lib/attachments";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Await } from "react-router";
import { toModelRef } from "~/lib/model-ref";
import { cn } from "~/lib/utils";
import { isFindError, type FindResult } from "~/routes/fs/find";
import type { SkillsResult } from "~/routes/skills";
import ModelPicker from "./model-picker";
import ThinkingLevelPicker from "./thinking-level-picker";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

/**
 * Derived from the route's response type rather than imported from
 * `~/services/skills.server`: that's a server-only module, and even a type-only
 * import of it from a client component is a trap waiting for someone to drop
 * the `type` keyword.
 */
type SkillSummary = SkillsResult["skills"][number];

/** how many `/fs/find` hits to show in the `@` dropdown */
const FILE_SEARCH_LIMIT = 20;

/**
 * Skills for a directory, cached for the life of the page. The *promise* is
 * cached rather than the array, so `/` presses that overlap an in-flight
 * request dedupe onto it instead of each firing their own.
 *
 * Deliberately no TTL: a skill added on disk needs a page reload to show up.
 * (`skills.server.ts` caches for 30 minutes on its side anyway.)
 */
const skillsCache = new Map<string, Promise<SkillSummary[]>>();

function getSkillsForDirectory(directory: string): Promise<SkillSummary[]> {
  const cached = skillsCache.get(directory);
  if (cached) return cached;

  const promise = fetchSkills(directory).catch((error: unknown) => {
    // the one thing that must *not* be cached forever: a rejection would kill
    // `/` for this directory until the page reloads
    skillsCache.delete(directory);
    throw error;
  });

  skillsCache.set(directory, promise);
  return promise;
}

async function fetchSkills(directory: string): Promise<SkillSummary[]> {
  // no AbortSignal on purpose: this promise is shared by every caller, so a
  // superseded keystroke aborting it would reject the search that's still live
  const response = await fetch(
    `/skills?directory=${encodeURIComponent(directory)}`,
  );
  const json = (await response.json()) as SkillsResult;

  // `/skills` has no error envelope -- a failure is HTML or a differently
  // shaped body, so the shape is checked rather than trusted
  return Array.isArray(json?.skills) ? json.skills : [];
}

/**
 * Without it `@` fires a request per keystroke. The initial empty-query search
 * always runs immediately regardless, which is free -- see `searchFiles`.
 */
const FILE_SEARCH_DEBOUNCE_MS = 150;

/**
 * Stable default for the `attachments` prop: a fresh `[]` literal would be a
 * new identity on every render and would re-run the memos and the file-input
 * sync effect for every call site that doesn't pass attachments.
 */
const EMPTY_ATTACHMENTS: Attachment[] = [];

const ALL_THINKING_LEVELS: ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Plain function, not a `useMemo`: this runs inside the `<Await>` render
 * callback, which React Router invokes from its own component, so hooks can't
 * be called there.
 */
function getThinkingLevels(
  models: readonly Model<Api>[],
  modelRef: string,
): ThinkingLevel[] {
  const selectedModel = models.find((model) => toModelRef(model) === modelRef);

  if (selectedModel?.thinkingLevelMap) {
    return Object.keys(selectedModel.thinkingLevelMap) as ThinkingLevel[];
  }

  return ALL_THINKING_LEVELS;
}

/**
 * Prompt input built on `prompt-area` instead of a plain textarea.
 *
 * Two things worth knowing:
 *
 * - Skills aren't a bespoke picker popover. They're a `/` *trigger*: the
 *   dropdown, keyboard nav and dismissal are owned by PromptArea, and a picked
 *   skill becomes an immutable chip whose plain text is `/skill:<name>` -- the
 *   string `_expandSkillCommand` matches on.
 * - The editor is contentEditable, so it contributes nothing to the form.
 *   The `prompt` field is submitted from a hidden input below.
 *
 * `markdown` is deliberately left off: markdown mode rewrites `- ` list
 * prefixes to `• `, which would silently mutate the text we send to the agent.
 */
export type PromptInputProps = {
  text: string;
  onTextChanged: (text: string) => void;
  modelRef: string;
  /** streamed from the loader: the pickers suspend, the rest of the input doesn't */
  modelsPromise: Promise<Model<Api>[]>;
  onModelChanged: (modelRef: string) => void;
  thinkingLevel: ThinkingLevel;
  thinkingLevelChanged: (thinkingLevel: ThinkingLevel) => void;
  /** a submission is in flight: block sending again */
  isBusy?: boolean;
  /**
   * the agent is mid-turn. swaps the send button into a stop button, which
   * submits `intent=abort`. Sending is still allowed via Enter (steering).
   */
  isStreaming?: boolean;
  /**
   * Root directory the `@` file search and the `/` skill list run against --
   * normally the session's cwd. Required, but an empty string is tolerated for
   * call sites whose cwd resolves asynchronously: the lookups are skipped
   * rather than firing requests the server would reject.
   */
  cwd: string;
  className?: string;
  /** Files staged for this prompt, owned by the page (see `useAttachments`). */
  attachments?: Attachment[];
  onAttachmentRemove?: (id: string) => void;
  /** Called for files picked from the paperclip button or pasted in. */
  onFilesSelected?: (files: File[]) => void;
};

export default function PromptInput({
  text,
  onTextChanged,
  modelRef,
  modelsPromise,
  onModelChanged,
  thinkingLevel,
  thinkingLevelChanged,
  cwd,
  className,
  isBusy = false,
  isStreaming = false,
  attachments = EMPTY_ATTACHMENTS,
  onAttachmentRemove,
  onFilesSelected,
}: PromptInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<PromptAreaHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deliverAsRef = useRef<HTMLInputElement>(null);
  const [segments, setSegments] = useState<Segment[]>(() =>
    plainTextToSegments(text),
  );

  const plainText = useMemo(() => segmentsToPlainText(segments), [segments]);

  // the last value this component pushed up. Without it the two effects below
  // fight: `text` lags a render behind `segments`, so the sync-down effect
  // would keep resetting the editor to the previous keystroke.
  const emittedTextRef = useRef(text);

  // editor -> parent
  useEffect(() => {
    if (plainText === emittedTextRef.current) return;
    emittedTextRef.current = plainText;
    onTextChanged(plainText);
  }, [plainText, onTextChanged]);

  // parent -> editor, for external changes only (e.g. the draft being cleared
  // after a send). Chips can't survive this round trip -- they're rebuilt as
  // plain text -- which is fine because it only fires when the parent replaces
  // the text wholesale.
  useEffect(() => {
    if (text === emittedTextRef.current) return;
    emittedTextRef.current = text;
    setSegments(plainTextToSegments(text));
  }, [text]);

  /**
   * Fetched once per directory and filtered in memory afterwards, so only the
   * first `/` in a folder costs a round trip. The `signal` isn't handed to
   * `fetch` -- see `fetchSkills` -- but it's still honoured here so a
   * superseded search doesn't repaint the dropdown.
   */
  const searchSkills = useCallback(
    async (
      query: string,
      { signal }: { signal: AbortSignal },
    ): Promise<TriggerSuggestion[]> => {
      if (!cwd) return [];

      let skills: SkillSummary[];
      try {
        skills = await getSkillsForDirectory(cwd);
      } catch {
        // surfaced through the trigger's `onSearchError`
        return [];
      }

      if (signal.aborted) return [];

      const normalized = query.trim().toLocaleLowerCase();

      return skills
        .filter(
          (skill) =>
            !normalized ||
            skill.name.toLocaleLowerCase().includes(normalized) ||
            skill.description.toLocaleLowerCase().includes(normalized),
        )
        .map((skill) => ({
          value: skill.name,
          label: skill.name,
          description: skill.description,
        }));
    },
    [cwd],
  );

  /**
   * Plain `fetch`, not `useFetcher`: `onSearch` has to *return* its results,
   * while `fetcher.load()` resolves to `void` and drops the data on
   * `fetcher.data` a render later, with no way to tie a result back to the
   * query that asked for it. `fetch` also accepts the `AbortSignal` PromptArea
   * hands us, so a superseded search is cancelled instead of racing.
   */
  const searchFiles = useCallback(
    async (
      query: string,
      { signal }: { signal: AbortSignal },
    ): Promise<TriggerSuggestion[]> => {
      // an empty query is valid: the server answers it with the root listing
      if (!cwd) return [];

      const params = new URLSearchParams({
        path: cwd,
        query,
        limit: String(FILE_SEARCH_LIMIT),
      });

      let result: FindResult;
      try {
        const response = await fetch(`/fs/find?${params}`, { signal });
        // deliberately not branching on `response.ok`: React Router unwraps and
        // re-serializes a resource route's `data(payload, 400)`, so the status
        // doesn't survive the trip. The payload shape is the source of truth.
        result = (await response.json()) as FindResult;
      } catch (error) {
        // an abort is a newer keystroke winning, not a failure
        if ((error as Error)?.name === "AbortError") return [];
        throw error;
      }

      if (isFindError(result)) return [];

      return result.matches.map((match) => ({
        // chip text is the path relative to `cwd`, so the agent receives
        // `@app/components/foo.tsx` rather than a machine-specific absolute path
        value: match.relativePath,
        label: match.name,
        description: match.relativePath,
        data: match,
      }));
    },
    [cwd],
  );

  const triggers = useMemo(
    () => [
      commandTrigger({
        // the agent only expands a skill when the *whole prompt* starts with
        // `/skill:` (bare `startsWith`, see `_expandSkillCommand`). 'start'
        // isn't enough -- it allows a `/` after any newline, so a skill on
        // line 2 would render a chip and then silently no-op.
        position: "input-start",
        onSearch: searchSkills,
        // the engine prepends the trigger char, so this returns `skill:<name>`
        // (no leading slash) and `segmentsToPlainText` renders the chip as
        // `/skill:<name>` -- the protocol the agent already expects
        onSelect: (suggestion) => `skill:${suggestion.value}`,
        emptyMessage: "No skills found",
        accessibilityLabel: "skill",
        chipClassName: 'bg-yellow-500/30 text-yellow-400 rounded-xs border border-border px-2 py-0.5 font-mono',
        onSearchError: (error) => console.error("skill search failed", error),
      }),
      mentionTrigger({
        onSearch: searchFiles,
        // chip text is the bare path, so `segmentsToPlainText` renders it as
        // `@<relative path>`
        onSelect: (suggestion) => suggestion.value,
        emptyMessage: "No files found",
        accessibilityLabel: "file",
        searchDebounceMs: FILE_SEARCH_DEBOUNCE_MS,
        onSearchError: (error) => console.error("file search failed", error),
         chipClassName: 'bg-blue-400/30 text-blue-300 rounded-xs border border-border px-2 py-0.5 font-mono',
      }),
    ],
    [searchSkills, searchFiles],
  );

  const images = useMemo<PromptAreaImage[]>(
    () =>
      attachments
        .filter((attachment) => attachment.kind === "image")
        .map((attachment) => ({
          id: attachment.id,
          url: attachment.previewUrl,
          alt: attachment.name,
        })),
    [attachments],
  );

  const files = useMemo<PromptAreaFile[]>(
    () =>
      attachments
        .filter((attachment) => attachment.kind !== "image")
        .map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          size: attachment.size,
          type: attachment.type,
        })),
    [attachments],
  );

  const hasImages = images.length > 0;

  /**
   * Mirror the staged files into a real `<input type="file">` so the native
   * form submission carries them.
   *
   * `DataTransfer` is the only sanctioned way to write a `FileList`. Doing it
   * this way keeps the send button's "submit with no submitter" trick intact
   * (see `submit` below); building the FormData by hand would lose it.
   */
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;

    // Nothing staged and nothing attached: leave the input alone rather than
    // churning a new empty FileList on every render.
    if (attachments.length === 0 && input.files?.length === 0) return;

    const transfer = new DataTransfer();
    for (const attachment of attachments) transfer.items.add(attachment.file);
    input.files = transfer.files;
  }, [attachments]);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []);
      // The effect above re-syncs the input from state, so the picked files are
      // routed through the page's handler rather than left sitting here.
      if (picked.length > 0) onFilesSelected?.(picked);
    },
    [onFilesSelected],
  );

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImagePaste = useCallback(
    (file: File) => {
      onFilesSelected?.([file]);
    },
    [onFilesSelected],
  );

  const handleImageRemove = useCallback(
    (image: PromptAreaImage) => {
      onAttachmentRemove?.(image.id);
    },
    [onAttachmentRemove],
  );

  const handleFileRemove = useCallback(
    (file: PromptAreaFile) => {
      onAttachmentRemove?.(file.id);
    },
    [onAttachmentRemove],
  );

  const canSend = !isBusy && plainText.trim().length > 0;

  /**
   * Written straight to the DOM rather than through state: React would not have
   * flushed a `setState` to the input before the native form submission reads
   * the form, so the server would get the *previous* value. Same reasoning as
   * the file input above.
   *
   * Every submit path calls this, always. Setting it only on the Alt+Enter path
   * would leave "followUp" sitting in the field, and the next plain Enter would
   * silently queue a follow-up.
   */
  const setDeliverAs = useCallback((value: "steer" | "followUp") => {
    if (deliverAsRef.current) deliverAsRef.current.value = value;
  }, []);

  const submit = useCallback(
    (_segments?: Segment[], modifiers?: SubmitModifiers) => {
      if (!canSend) return;

      // Alt+Enter queues a follow-up instead of a steer. It only *means*
      // anything while the agent is streaming -- pi ignores the queue choice
      // when it is idle and sends immediately -- so there is no need to read
      // isStreaming here and race the agent loop over it.
      setDeliverAs(modifiers?.altKey ? "followUp" : "steer");

      // requestSubmit() with *no submitter*, exactly like the textarea version:
      // the send button's `name=intent` pair must not land in the FormData, so
      // the server reads the absent intent as "prompt". This is what stops Enter
      // from aborting the turn while the stop button is showing. Do not "fix"
      // this by passing the button as the submitter.
      containerRef.current?.closest("form")?.requestSubmit();
    },
    [canSend, setDeliverAs],
  );

  /**
   * The send button submits natively, so it never runs `submit` above. It still
   * has to pin the field down -- see setDeliverAs. Alt+click is deliberately
   * not special-cased: Alt+Enter is the only follow-up gesture.
   */
  const handleSendClick = useCallback(() => {
    setDeliverAs("steer");
  }, [setDeliverAs]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "border border-input bg-transparent p-2 shadow-xs focus-within:border-ring",
        className,
      )}
      style={{
        // @ts-expect-error - the CSS variable is defined in the theme, but TS doesn't know it
        "--radius": "0",
      }}
    >
      {hasImages && (
        <VisionWarning modelsPromise={modelsPromise} modelRef={modelRef} />
      )}

      {/* not `type="hidden"`: a hidden input can't carry files. Visually
          removed instead, and driven entirely by the effect above. */}
      <input
        ref={fileInputRef}
        type="file"
        name={ATTACHMENT_FIELD_NAME}
        multiple
        onChange={handleFileInputChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />

      {/* submitted alongside the hidden `prompt` field below */}
      <input type="hidden" name="modelRef" value={modelRef} />
      <input type="hidden" name="thinkingLevel" value={thinkingLevel} />
      {/* uncontrolled on purpose: `setDeliverAs` writes the DOM value directly,
          and a React-controlled `value` would fight it on the next render */}
      <input
        ref={deliverAsRef}
        type="hidden"
        name="deliverAs"
        defaultValue="steer"
      />
      {/* the editor is contentEditable and has no form value of its own.
          .trim(), not .trimEnd(): `input-start` tolerates leading whitespace but
          the agent matches `/skill:` with a bare startsWith and never trims, so
          a single leading space silently kills skill expansion. */}
      <input type="hidden" name="prompt" value={plainText.trim()} />

      <PromptArea
        ref={promptRef}
        value={segments}
        onChange={setSegments}
        triggers={triggers}
        placeholder="Message Pi..."
        aria-label="Next predefined message"
        onSubmit={submit}
        minHeight={80}
        maxHeight={240}
        className="px-1 py-1.5"
        data-test-id="prompt-input"
        images={images}
        files={files}
        onImagePaste={handleImagePaste}
        onImageRemove={handleImageRemove}
        onFileRemove={handleFileRemove}
      />

      <ActionBar
        className="pt-1"
        left={
          /* only the pickers wait on the models promise; the editor, the
             hidden fields and the send button stay outside the boundary so
             composing and sending are never blocked. */
          <Suspense
            fallback={
              <>
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-8 w-24" />
              </>
            }
          >
            <Await
              resolve={modelsPromise}
              errorElement={
                <span className="text-xs text-muted-foreground">
                  Models unavailable
                </span>
              }
            >
              {(models: Model<Api>[]) => (
                <>
                  <ModelPicker
                    modelRef={modelRef}
                    models={models}
                    onModelChanged={onModelChanged}
                  />
                  <ThinkingLevelPicker
                    thinkingLevels={getThinkingLevels(models, modelRef)}
                    thinkingLevel={thinkingLevel}
                    onThinkingLevelChanged={thinkingLevelChanged}
                  />
                </>
              )}
            </Await>
          </Suspense>
        }
        right={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleAttachClick}
              disabled={isBusy}
              aria-label="Attach files"
            >
              <PaperclipIcon />
            </Button>
            <Button
              type="submit"
              name="intent"
              value={isStreaming ? "abort" : "prompt"}
              variant="default"
              size="icon-sm"
              onClick={handleSendClick}
              // while streaming there's nothing to type for a stop, so the empty
              // editor must not disable it
              // native submit button: clicking it *does* contribute
              // `intent=abort|prompt`, which is what the stop button needs
              disabled={isStreaming ? isBusy : !canSend}
            >
              {isStreaming ? <SquareIcon /> : <ArrowUpIcon />}
              <span className="sr-only">{isStreaming ? "Stop" : "Send"}</span>
            </Button>
          </>
        }
      />
    </div>
  );
}

/**
 * Warns that the selected model will not see the attached images.
 *
 * pi does not error in this case -- `transformMessages` silently swaps each
 * image for the text `(image omitted: model does not support images)` -- so
 * without this the user gets a confident answer about an image the model never
 * received.
 *
 * Rendered inside its own boundary because the models promise is streamed: the
 * composer must never suspend on it.
 */
function VisionWarning({
  modelsPromise,
  modelRef,
}: {
  modelsPromise: Promise<Model<Api>[]>;
  modelRef: string;
}) {
  return (
    <Suspense fallback={null}>
      <Await resolve={modelsPromise} errorElement={null}>
        {(models: Model<Api>[]) => {
          const selected = models.find((model) => toModelRef(model) === modelRef);

          // Unknown model: say nothing rather than warn about a guess.
          if (!selected || selected.input.includes("image")) return null;

          return (
            <Alert variant="destructive" className="mb-2">
              <TriangleAlertIcon />
              <AlertTitle>This model can&apos;t read images</AlertTitle>
              <AlertDescription>
                Your attached images will be replaced with a placeholder. Pick a
                model with vision support to send them.
              </AlertDescription>
            </Alert>
          );
        }}
      </Await>
    </Suspense>
  );
}
