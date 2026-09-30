import { X } from "lucide-react";
import { useMemo } from "react";
import DelayedRender, { FAST_DELAY } from "~/components/delayed-render";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { FileItem } from "~/routes/fs/fs.types";
import CodeEditor from "./code-editor";
import { toMonacoLanguage } from "./monaco-language";
import { useFileContent } from "./use-file-content";

/**
 * The contents of the file currently selected in the tree, in a read-only
 * Monaco editor.
 *
 * Mounted only while a file is active. It is *not* keyed on the path: Monaco
 * keeps one model per file, so switching files swaps buffers (and preserves
 * each file's scroll position) instead of tearing down the editor.
 */
export default function FileViewerPanel({
  file,
  refreshToken,
  onClose,
}: {
  file: FileItem;
  refreshToken: number;
  onClose: () => void;
}) {
  const state = useFileContent(file.path, file.name, refreshToken);

  const language = useMemo(() => toMonacoLanguage(file.name), [file.name]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <span
          title={file.displayPath}
          className="text-muted-foreground min-w-0 flex-1 truncate px-1 font-mono text-xs"
        >
          {file.name}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close file"
                onClick={onClose}
              />
            }
          >
            <X />
          </TooltipTrigger>
          <TooltipContent>Close file</TooltipContent>
        </Tooltip>
      </div>

      {/* no `overflow-auto`: Monaco scrolls itself, and an outer scroller
          would stop it from ever measuring a bounded height */}
      <div className="min-h-0 flex-1">
        {state.status === "loading" && (
          // a local read is usually instant; delaying avoids a flash
          <DelayedRender delay={FAST_DELAY}>
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-3 w-4/5 rounded-sm" />
              <Skeleton className="h-3 w-3/5 rounded-sm" />
              <Skeleton className="h-3 w-2/3 rounded-sm" />
            </div>
          </DelayedRender>
        )}

        {state.status === "error" && (
          <p className="text-destructive p-3 text-sm">{state.message}</p>
        )}

        {state.status === "unsupported" && (
          <p className="text-muted-foreground p-3 text-sm">{state.message}</p>
        )}

        {state.status === "loaded" && (
          <CodeEditor
            filePath={file.path}
            language={language}
            value={state.text}
          />
        )}
      </div>
    </div>
  );
}
