import type * as Pi from "@earendil-works/pi-ai";
import {
  useIsStreaming,
  useIsThinking,
  useMessage,
  usePartialToolResult,
  useToolResult,
} from "~/store/selectors";
import { Message, MessageContent } from "./ui/message";
import { Bubble, BubbleContent } from "./ui/bubble";
import { Badge } from "./ui/badge";
import { parseUserMessageSegments } from "~/lib/user-message-segments";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  memo,
  type ReactNode,
} from "react";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "./ui/attachment";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { FileIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Terminal, TerminalContent } from "./ai-elements/terminal";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./ai-elements/reasoning";
import { CodeBlock } from "~/components/ai-elements/code-block";
import type { BundledLanguage } from "shiki";
import { bundledLanguages } from "shiki";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

type Props = {
  sessionId: string;
  messageIndex: number;
};

type ChatMessageContextValue = {
  sessionId: string;
  messageIndex: number;
};

export const ChatMessageContext = createContext<
  ChatMessageContextValue | undefined
>(undefined);

export function useChatMessageContext() {
  const context = useContext(ChatMessageContext);

  if (!context) {
    throw new Error(
      "useChatMessageContext must be used within a ChatMessageContext provider",
    );
  }

  return context;
}

export function ChatMessage({ sessionId, messageIndex }: Props) {
  const message = useMessage(sessionId, messageIndex);
  const contextValue = useMemo(
    () => ({ sessionId, messageIndex }),
    [sessionId, messageIndex],
  );

  if (!message) {
    return null;
  }

  return (
    <ChatMessageContext.Provider value={contextValue}>
      {message.role === "user" ? (
        <UserMessage message={message} />
      ) : message.role === "assistant" ? (
        <AssistantMessage message={message} />
      ) : null}
    </ChatMessageContext.Provider>
  );
}

type UserMessageProps = {
  message: Pi.UserMessage;
};

function UserMessage({ message }: UserMessageProps) {
  /**
   * Runs of consecutive images are collapsed into one row. `MessageContent` is
   * a flex *column*, so rendering three images as three children stacks them
   * full width down the bubble instead of side by side.
   */
  const blocks = useMemo(
    () =>
      typeof message.content === "string"
        ? [{ kind: "text" as const, text: message.content }]
        : groupUserContent(message.content),
    [message.content],
  );

  return (
    <Message align="end">
      <MessageContent>
        {blocks.map((block, blockIndex) =>
          block.kind === "text" ? (
            <UserTextContent key={blockIndex} text={block.text} />
          ) : (
            <ImageRow key={blockIndex} images={block.images} />
          ),
        )}
      </MessageContent>
    </Message>
  );
}

type UserContentBlock =
  | { kind: "text"; text: string }
  | { kind: "images"; images: Pi.ImageContent[] };

function groupUserContent(
  content: (Pi.TextContent | Pi.ImageContent)[],
): UserContentBlock[] {
  const blocks: UserContentBlock[] = [];

  for (const item of content) {
    if (item.type === "text") {
      blocks.push({ kind: "text", text: item.text });
      continue;
    }

    if (item.type !== "image") continue;

    const previous = blocks[blocks.length - 1];

    if (previous?.kind === "images") {
      previous.images.push(item);
      continue;
    }

    blocks.push({ kind: "images", images: [item] });
  }

  return blocks;
}

type UserTextContentProps = { text: string };

/**
 * Renders a user message with its `/skill:<name>` and `@<path>` mentions as
 * badges, inline with the surrounding text inside a single bubble.
 */
function UserTextContent({ text }: UserTextContentProps) {
  const segments = useMemo(() => parseUserMessageSegments(text), [text]);

  if (segments.length === 0) {
    return null;
  }

  return (
    <Bubble variant='secondary'>
      <BubbleContent>
        {segments.map((segment, segmentIndex) => {
          if (segment.type === "skill") {
            return (
              <Badge
                key={segmentIndex}
                className="mx-0.5 max-w-full align-middle font-mono px-1 bg-background"
                variant="outline"
              >
                /skill:{segment.name}
              </Badge>
            );
          }

          if (segment.type === "file") {
            return (
              <Badge
                key={segmentIndex}
                className="mx-0.5 max-w-full align-middle font-mono px-1 bg-background"
                variant="outline"
                title={segment.relativePath}
              >
                @{segment.name}
              </Badge>
            );
          }

          if (segment.type === "fileRef") {
            return (
              <Attachment
                key={segmentIndex}
                size="sm"
                className="my-1 bg-background"
                title={segment.path}
              >
                <AttachmentMedia>
                  <FileIcon />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{segment.name}</AttachmentTitle>
                  <AttachmentDescription>{segment.size}</AttachmentDescription>
                </AttachmentContent>
              </Attachment>
            );
          }

          return (
            <span key={segmentIndex} className="whitespace-pre-wrap">
              {segment.text}
            </span>
          );
        })}
      </BubbleContent>
    </Bubble>
  );
}

type AssistantMessageProps = {
  message: Pi.AssistantMessage;
};

function AssistantMessage({ message }: AssistantMessageProps) {
  return (
    <Message align="start">
      <MessageContent>
        {message.content.map((content, contentIndex) => (
          <ChatContent
            key={contentIndex}
            content={content}
            contentIndex={contentIndex}
            variant="muted"
          />
        ))}
      </MessageContent>
    </Message>
  );
}

type ChatContentProps = {
  content: Pi.TextContent | Pi.ThinkingContent | Pi.ToolCall | Pi.ImageContent;
  contentIndex: number;
  variant?: "muted";
};

function ChatContent({ content, contentIndex, variant }: ChatContentProps) {
  if (content.type === "text") {
    return <TextMessageContent content={content} />;
  }

  if (content.type === "image") {
    return <ImageContent message={content} />;
  }

  if (content.type === "thinking") {
    return <ThinkingContent content={content} contentIndex={contentIndex} />;
  }

  if (content.type === "toolCall") {
    return <ToolCallContent toolCall={content} />;
  }

  return null;
}

type TextMessageContentProps = { content: Pi.TextContent };

const streamdownPlugins = { cjk, code, math, mermaid };

const TextMessageContent = memo(({ content }: TextMessageContentProps) => {
  const { sessionId } = useChatMessageContext()
  const isStreaming = useIsStreaming(sessionId);

  return (
    <Streamdown
      className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 my-2"
      plugins={streamdownPlugins}
      isAnimating={isStreaming}
      mode={isStreaming ? 'streaming' : 'static'}
    >
      {content.text}
    </Streamdown>
  )


} );

TextMessageContent.displayName = "TextMessageContent";

type ImageContentProps = { message: Pi.ImageContent };

/**
 * Renders one image block from session history.
 *
 * A data URL, not an object URL: `message.data` is base64 *text*, so
 * `new Blob([message.data])` produces a blob full of base64 characters rather
 * than image bytes, and the `<img>` silently never loads.
 *
 * The memo matters because a session snapshot rebuilds every message object,
 * which would otherwise re-run this with a multi-megabyte string on every SSE
 * frame. `useMemo` still holds across those rebuilds: its dependency check is
 * `Object.is`, which compares strings by value.
 */
const ImageContent = memo(({ message }: ImageContentProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  const source = useMemo(
    () => `data:${message.mimeType};base64,${message.data}`,
    [message.mimeType, message.data],
  );

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleError = useCallback(() => setHasFailed(true), []);

  if (hasFailed) {
    return (
      <Attachment size="sm" state="error">
        <AttachmentMedia>
          <FileIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>Couldn&apos;t display this image</AttachmentTitle>
          <AttachmentDescription>{message.mimeType}</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="border-border size-24 shrink-0 cursor-pointer overflow-hidden border bg-muted"
        aria-label="View attached image"
      >
        <img
          src={source}
          alt="Attached image"
          onError={handleError}
          className="size-full object-cover"
        />
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-auto max-w-[90vw] sm:max-w-[90vw]">
          <DialogTitle className="sr-only">Attached image</DialogTitle>
          <img
            src={source}
            alt="Attached image"
            className="max-h-[85vh] max-w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
});

ImageContent.displayName = "ImageContent";

/**
 * A side-by-side run of images inside one message.
 *
 * The `data-slot` is required, not decorative: `MessageContent` right-aligns a
 * user message with `group-data-[align=end]/message:*:data-slot:self-end`,
 * which only matches direct children carrying that attribute. Without it this
 * row stretches the full width and reads as left-aligned.
 */
function ImageRow({ images }: { images: Pi.ImageContent[] }) {
  return (
    <div data-slot="message-images" className="flex flex-wrap gap-2">
      {images.map((image, index) => (
        <ImageContent key={index} message={image} />
      ))}
    </div>
  );
}

/**
 * Images returned by a tool -- `read` on a PNG, a screenshot extension, an MCP
 * bridge. `getToolResultText` drops every non-text block, so without this they
 * never reach the screen at all.
 */
function ToolResultImages({
  result,
}: {
  result?: Pi.ToolResultMessage | AgentToolResult<unknown>;
}) {
  const images = useMemo(
    () =>
      (result?.content ?? []).filter(
        (content): content is Pi.ImageContent => content.type === "image",
      ),
    [result],
  );

  if (images.length === 0) return null;

  return <ImageRow images={images} />;
}

type ThinkingContentProps = {
  content: Pi.ThinkingContent;
  contentIndex: number;
};

function ThinkingContent({ content, contentIndex }: ThinkingContentProps) {
  const { sessionId, messageIndex } = useChatMessageContext();
  const isThinking = useIsThinking(sessionId, messageIndex, contentIndex);

  return (
    <Reasoning
      isStreaming={isThinking}
      collapsible={content.thinking.length > 0}
    >
      <ReasoningTrigger className="text-xs" />
      <ReasoningContent>{content.thinking}</ReasoningContent>
    </Reasoning>
  );
}

type ToolCallContentProps = { toolCall: Pi.ToolCall };

function ToolCallContent({ toolCall }: ToolCallContentProps) {
  const { sessionId } = useChatMessageContext();
  const toolResult = useToolResult(sessionId, toolCall.id);
  const partialToolResult = usePartialToolResult(sessionId, toolCall.id);

  if (toolCall.name === "bash") {
    return (
      <BashToolCall
        sessionId={sessionId}
        toolCall={toolCall}
        toolResult={toolResult}
        partialToolResult={partialToolResult}
      />
    );
  }

  if (toolCall.name === "read") {
    return (
      <ReadToolCall
        toolCall={toolCall}
        toolResult={toolResult}
        partialToolResult={partialToolResult}
      />
    );
  }

  if (toolCall.name === "find") {
    return (
      <FindToolCall
        toolCall={toolCall}
        toolResult={toolResult}
        partialToolResult={partialToolResult}
      />
    );
  }

  if (toolCall.name === "ls") {
    return (
      <LsToolCall
        toolCall={toolCall}
        toolResult={toolResult}
        partialToolResult={partialToolResult}
      />
    );
  }

  if (toolCall.name === "grep") {
    return (
      <GrepToolCall
        toolCall={toolCall}
        toolResult={toolResult}
        partialToolResult={partialToolResult}
      />
    );
  }

  if (toolCall.name === "edit") {
    return <EditToolCall toolCall={toolCall} toolResult={toolResult} />;
  }

  if (toolCall.name === "write") {
    return (
      <WriteToolCall
        toolCall={toolCall}
        toolResult={toolResult}
        partialToolResult={partialToolResult}
      />
    );
  }

  return (
    <div>
      <div>
        <b>{toolCall.name}</b>
      </div>

      <div>
        Params:
        <br />
        <pre>{JSON.stringify(toolCall.arguments, null, 2)}</pre>
      </div>

      {partialToolResult ? (
        <pre>
          Partial Result: <br />
          {JSON.stringify(partialToolResult, null, 2)}
        </pre>
      ) : toolResult ? (
        <pre>
          Result: <br />
          {JSON.stringify(toolResult, null, 2)}
        </pre>
      ) : (
        <div>Waiting for result...</div>
      )}

      {/* an extension or MCP tool can return images; the JSON dumps above
          show them only as a wall of base64 */}
      <ToolResultImages result={toolResult ?? partialToolResult} />
    </div>
  );
}

type BashToolCallProps = {
  toolCall: Pi.ToolCall;
  toolResult?: Pi.ToolResultMessage;
  partialToolResult?: AgentToolResult<unknown>;
  sessionId: string;
};

/**
 * Extracts and concatenates all text content from a (partial) tool result.
 */
function getToolResultText(
  result?: Pi.ToolResultMessage | AgentToolResult<unknown>,
): string {
  if (!result) return "";

  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function BashToolCall({
  toolCall,
  toolResult,
  partialToolResult,
}: BashToolCallProps) {
  const output = useMemo(() => {
    const prefix = "\u001B[36m$\u001B[0m";
    const command = String(toolCall.arguments.command);

    return `${prefix} ${command}\n${getToolResultText(toolResult ?? partialToolResult)}`;
  }, [toolResult, partialToolResult, toolCall]);
  return (
    <Tool>
      <ToolHeader
        title={!toolResult ? "Running" : "Ran"}
        subtitle={toolCall.arguments.command}
      />

      <ToolContent>
        {!output ? (
          <div>...</div>
        ) : (
          <Terminal
            output={output}
            isStreaming={!toolResult}
            autoScroll={true}
            className={cn(toolResult?.isError && "border-destructive/40")}
          >
            <TerminalContent />
          </Terminal>
        )}
      </ToolContent>
    </Tool>
  );
}

const FALLBACK_LANGUAGE: BundledLanguage = "md";

/** Extensions that shiki doesn't already expose as a language id or alias. */
const EXTENSION_ALIASES: Record<string, BundledLanguage> = {
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  hh: "cpp",
  htm: "html",
  mts: "ts",
  cts: "ts",
  txt: "md",
  log: "md",
  env: "shellscript",
  gitignore: "shellscript",
};

type ReadToolCallProps = {
  toolCall: Pi.ToolCall;
  toolResult?: Pi.ToolResultMessage;
  partialToolResult?: AgentToolResult<unknown>;
};

function ReadToolCall({
  toolCall,
  toolResult,
  partialToolResult,
}: ReadToolCallProps) {
  const textContent = useMemo(
    () => getToolResultText(partialToolResult ?? toolResult),
    [toolResult, partialToolResult],
  );

  const language = useMemo<BundledLanguage>(() => {
    const path = toolCall.arguments.path as string | undefined;
    const ext = path?.split(".").pop()?.toLowerCase();

    if (!ext) return FALLBACK_LANGUAGE;

    // shiki's bundledLanguages is keyed by language id *and* alias
    // (ts, py, rs, rb, cs, md, ...), so most extensions are a direct hit.
    const alias = EXTENSION_ALIASES[ext] ?? ext;

    return alias in bundledLanguages
      ? (alias as BundledLanguage)
      : FALLBACK_LANGUAGE;
  }, [toolCall]);

  return (
    <Tool>
      <ToolHeader
        title={!toolResult ? "Reading" : "Read"}
        subtitle={toolCall.arguments.path}
      />

      <ToolContent>
        {!textContent ? (
          <div>...</div>
        ) : (
          <CodeBlock code={textContent} language={language} />
        )}

        {/* pi's read tool returns an image block for PNG, JPEG, GIF, WebP and
            BMP files. Without this the user sees only the "Read image file"
            note and never the image itself. */}
        <ToolResultImages result={toolResult ?? partialToolResult} />
      </ToolContent>
    </Tool>
  );
}

type FindToolCallProps = {
  toolCall: Pi.ToolCall;
  toolResult?: Pi.ToolResultMessage;
  partialToolResult?: AgentToolResult<unknown>;
};

function FindToolCall({
  toolCall,
  toolResult,
  partialToolResult,
}: FindToolCallProps) {
  const textContent = useMemo(
    () => getToolResultText(partialToolResult ?? toolResult),
    [toolResult, partialToolResult],
  );

  const subtitle = useMemo(
    () => `files ${toolCall.arguments.pattern ?? ""}`,
    [toolCall],
  );

  return (
    <Tool>
      <ToolHeader
        title={!toolResult ? "Searching" : "Searched"}
        subtitle={subtitle}
      />

      <ToolContent>
        {!textContent ? (
          <div>...</div>
        ) : (
          <CodeBlock code={textContent} language="md" />
        )}
      </ToolContent>
    </Tool>
  );
}

type LsToolCallProps = {
  toolCall: Pi.ToolCall;
  toolResult?: Pi.ToolResultMessage;
  partialToolResult?: AgentToolResult<unknown>;
};

/** The ls tool returns this exact string when a directory has no entries. */
const LS_EMPTY_DIRECTORY = "(empty directory)";

/**
 * The ls tool returns one entry per line, then optionally appends truncation
 * notices as `\n\n[... limit reached]`. Everything from that blank line on is
 * not an entry, so we stop counting there.
 */
function parseLsEntries(text: string): string[] {
  const trimmed = text.trim();

  if (!trimmed || trimmed === LS_EMPTY_DIRECTORY) return [];

  const entries: string[] = [];

  for (const line of trimmed.split("\n")) {
    if (line.trim() === "") break;
    entries.push(line);
  }

  return entries;
}

function LsToolCall({
  toolCall,
  toolResult,
  partialToolResult,
}: LsToolCallProps) {
  const entries = useMemo(
    () => parseLsEntries(getToolResultText(partialToolResult ?? toolResult)),
    [toolResult, partialToolResult],
  );

  const subtitle = useMemo(() => {
    const path = toolCall.arguments.path || ".";

    if (!toolResult) return `${path}`;

    const count = entries.length;

    return `${count} ${count === 1 ? "item" : "items"} in ${path}`;
  }, [toolCall, toolResult, entries]);

  return (
    <Tool>
      <ToolHeader
        title={!toolResult ? "Listing" : "Listed"}
        subtitle={subtitle}
      />

      <ToolContent>
        {entries.length === 0 ? (
          <div className="text-muted-foreground text-xs">
            {toolResult ? LS_EMPTY_DIRECTORY : "..."}
          </div>
        ) : (
          <div className="flex flex-col font-mono text-xs">
            {entries.map((entry) => (
              <span
                key={entry}
                className={cn(
                  "truncate",
                  entry.endsWith("/") && "text-muted-foreground",
                )}
              >
                {entry}
              </span>
            ))}
          </div>
        )}
      </ToolContent>
    </Tool>
  );
}

type GrepToolCallProps = {
  toolCall: Pi.ToolCall;
  toolResult?: Pi.ToolResultMessage;
  partialToolResult?: AgentToolResult<unknown>;
};

type GrepMatch = {
  key: string;
  location?: string;
  text: string;
};

/** Matches `path:line:content`, where path may contain a windows drive letter. */
const GREP_LINE_REGEX = /^((?:[a-zA-Z]:)?[^:]*:\d+:)(.*)$/;

function GrepToolCall({
  toolCall,
  toolResult,
  partialToolResult,
}: GrepToolCallProps) {
  const matches = useMemo<GrepMatch[]>(() => {
    const text = getToolResultText(partialToolResult ?? toolResult);
    if (!text) return [];

    return text.split("\n").map((line, index) => {
      const parsed = GREP_LINE_REGEX.exec(line);

      return {
        key: `${index}-${line}`,
        location: parsed?.[1],
        text: parsed?.[2] ?? line,
      };
    });
  }, [toolResult, partialToolResult]);

  const subtitle = useMemo(() => {
    const pattern = toolCall.arguments.pattern ?? "";
    const path = toolCall.arguments.path;

    return path ? `${pattern} in ${path}` : `${pattern}`;
  }, [toolCall]);

  return (
    <Tool>
      <ToolHeader
        title={!toolResult ? "Grepping" : "Grepped"}
        subtitle={subtitle}
      />

      <ToolContent>
        {matches.length === 0 ? (
          <div>...</div>
        ) : (
          <div className="flex flex-col font-mono text-xs">
            {matches.map((match) => (
              <div key={match.key} className="flex gap-2">
                {match.location ? (
                  <span className="shrink-0 text-muted-foreground">
                    {match.location}
                  </span>
                ) : null}
                <span className="truncate">{match.text}</span>
              </div>
            ))}
          </div>
        )}
      </ToolContent>
    </Tool>
  );
}

type EditToolCallProps = {
  toolCall: Pi.ToolCall;
  toolResult?: Pi.ToolResultMessage<{ patch?: string } | undefined>;
};

type EditToolEdit = { oldText: string; newText: string };

function EditToolCall({ toolCall, toolResult }: EditToolCallProps) {
  const edits = useMemo<EditToolEdit[]>(() => {
    const value = toolCall.arguments.edits;
    return Array.isArray(value) ? (value as EditToolEdit[]) : [];
  }, [toolCall]);

  const patch = useMemo(() => toolResult?.details?.patch, [toolResult]);

  return (
    <Tool>
      <ToolHeader
        title={!toolResult ? "Editing" : "Edited"}
        subtitle={toolCall.arguments.path}
      />

      <ToolContent>
        {patch ? (
          <CodeBlock code={patch} language="diff" />
        ) : edits.length === 0 ? (
          <div>...</div>
        ) : (
          <div className="flex flex-col gap-2 font-mono text-xs">
            {edits.map((edit, index) => (
              <div key={index} className="flex flex-col">
                {edit.oldText ? (
                  <pre className="whitespace-pre-wrap text-destructive">
                    {edit.oldText
                      .split("\n")
                      .map((line) => `- ${line}`)
                      .join("\n")}
                  </pre>
                ) : null}
                {edit.newText ? (
                  <pre className="whitespace-pre-wrap text-green-600 dark:text-green-400">
                    {edit.newText
                      .split("\n")
                      .map((line) => `+ ${line}`)
                      .join("\n")}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </ToolContent>
    </Tool>
  );
}

type WriteToolCallProps = {
  toolCall: Pi.ToolCall;
  toolResult?: Pi.ToolResultMessage;
  partialToolResult?: AgentToolResult<unknown>;
};

function WriteToolCall({
  toolCall,
  toolResult,
  partialToolResult,
}: WriteToolCallProps) {
  const textContent = useMemo(
    () => getToolResultText(partialToolResult ?? toolResult),
    [toolResult, partialToolResult],
  );

  const language = useMemo<BundledLanguage>(() => {
    const path = toolCall.arguments.path as string | undefined;
    const ext = path?.split(".").pop()?.toLowerCase();

    if (!ext) return FALLBACK_LANGUAGE;

    // shiki's bundledLanguages is keyed by language id *and* alias
    // (ts, py, rs, rb, cs, md, ...), so most extensions are a direct hit.
    const alias = EXTENSION_ALIASES[ext] ?? ext;

    return alias in bundledLanguages
      ? (alias as BundledLanguage)
      : FALLBACK_LANGUAGE;
  }, [toolCall]);

  return (
    <Tool>
      <ToolHeader
        title={!toolResult ? "Writing" : "Wrote"}
        subtitle={toolCall.arguments.path}
      />

      <ToolContent>
        {!textContent ? (
          <div>...</div>
        ) : (
          <CodeBlock code={toolCall.arguments.content} language={language} />
        )}
      </ToolContent>
    </Tool>
  );
}

type ToolProps = {
  children: ReactNode;
  defaultIsOpen?: boolean;
};

function Tool({ children, defaultIsOpen = false }: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultIsOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      {children}
    </Collapsible>
  );
}

type ToolHeaderProps = {
  title: string;
  subtitle?: string;
};

function ToolHeader({ title, subtitle }: ToolHeaderProps) {
  return (
    <CollapsibleTrigger className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity group max-w-full">
      <span className="text-foreground">{title}</span>

      <div className="truncate text-muted-foreground grow shrink">{subtitle}</div>

      <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90 rotate-0" />
    </CollapsibleTrigger>
  );
}
type ToolContentProps = {
  children: ReactNode;
};

function ToolContent({ children }: ToolContentProps) {
  return <CollapsibleContent className="pt-2 ">{children}</CollapsibleContent>;
}
