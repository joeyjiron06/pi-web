import { lazy, Suspense } from "react";
import useIsClient from "~/hooks/use-is-client";
import { Skeleton } from "~/components/ui/skeleton";

/**
 * Loaded lazily so the ~1MB editor entry never ships with the initial bundle
 * (the chat routes don't use it), and so the module -- which touches `window`
 * on import -- is only ever evaluated in the browser.
 */
const CodeEditorClient = lazy(() => import("./code-editor.client"));

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
  filePath: string;
  language: string;
  value: string;
};

/**
 * SSR-safe entry point for the read-only Monaco editor.
 *
 * `lazy` alone isn't enough: React would suspend during the server render and
 * import the client module on the server anyway. Gating on `useIsClient`
 * means the server (and the hydration pass) render the skeleton, and the real
 * editor is only requested once we're mounted in the browser.
 */
export default function CodeEditor({ filePath, language, value }: Props) {
  const isClient = useIsClient();

  if (!isClient) return <EditorSkeleton />;

  return (
    <Suspense fallback={<EditorSkeleton />}>
      <CodeEditorClient
        filePath={filePath}
        language={language}
        value={value}
        loading={<EditorSkeleton />}
      />
    </Suspense>
  );
}
