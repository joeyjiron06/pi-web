import DelayedRender, { FAST_DELAY } from "~/components/delayed-render";
import { Skeleton } from "~/components/ui/skeleton";
import { FileTreeMessageRow } from "./file-tree-row";

/**
 * A single placeholder row shown while a folder's contents are in flight.
 *
 * One row rather than several: the listing usually comes back in a few
 * milliseconds, and a multi-row block reads as "this folder has 3 things in
 * it", which is a guess the skeleton has no business making.
 *
 * Rendered at the same depth and row height as the real entries, so nothing
 * shifts vertically or horizontally when the listing arrives.
 *
 * The delay is baked in here rather than at the call site so no caller can
 * forget it: a local `readdir` normally returns well inside `FAST_DELAY`, and
 * an un-delayed skeleton would flash on every expand.
 */
export default function FileTreeSkeleton({ depth }: { depth: number }) {
  return (
    <DelayedRender delay={FAST_DELAY}>
      <FileTreeMessageRow depth={depth}>
        {/* matches the chevron + icon gutter of a real row */}
        <span className="w-4 shrink-0" />
        <Skeleton className="h-3 w-32 rounded-sm" />
      </FileTreeMessageRow>
    </DelayedRender>
  );
}
