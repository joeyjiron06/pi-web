import { lazy, Suspense } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import useIsClient from "~/hooks/use-is-client";

/**
 * Loaded lazily so the ~1MB editor entry never ships with the initial bundle,
 * and so the module -- which touches `window` on import -- is only ever
 * evaluated in the browser.
 */
const GitDiffEditorClient = lazy(() => import("./git-diff-editor.client"));

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      <Skeleton className="h-3 w-4/5 rounded-sm" />
      <Skeleton className="h-3 w-3/5 rounded-sm" />
      <Skeleton className="h-3 w-2/3 rounded-sm" />
    </div>
  );
}

type Props = {
  language: string;
  original: string;
  modified: string;
  isSideBySide: boolean;
};

/**
 * SSR-safe entry point for the read-only Monaco diff editor. Mirrors
 * `code-editor.tsx`: `lazy` alone isn't enough, because React would suspend
 * during the server render and import the client module on the server anyway.
 */
export default function GitDiffEditor({
  language,
  original,
  modified,
  isSideBySide,
}: Props) {
  const isClient = useIsClient();

  if (!isClient) return <EditorSkeleton />;

  return (
    <Suspense fallback={<EditorSkeleton />}>
      <GitDiffEditorClient
        language={language}
        original={original}
        modified={modified}
        isSideBySide={isSideBySide}
        loading={<EditorSkeleton />}
      />
    </Suspense>
  );
}
