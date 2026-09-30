import { useMemo } from "react";
import { cn } from "~/lib/utils";

/** Indent per depth level, applied as padding so the hover row still spans full width. */
export const INDENT_PER_LEVEL_PX = 12;

/**
 * Deeply nested trees would otherwise push the name off the edge of a narrow
 * sidebar, leaving a row that's all indent and no label.
 */
const MAX_INDENT_LEVEL = 10;

/**
 * Left padding for a row at `depth`, matching the git panel's rows so the two
 * tabs line up when you switch between them.
 */
export function useRowStyle(depth: number) {
  return useMemo(
    () => ({
      paddingLeft: `${Math.min(depth, MAX_INDENT_LEVEL) * INDENT_PER_LEVEL_PX + 8}px`,
    }),
    [depth],
  );
}

/**
 * A non-interactive row (skeletons, error and empty messages). Interactive
 * rows are built directly by their owners, since a `CollapsibleTrigger` has to
 * render the `<button>` itself.
 */
export function FileTreeMessageRow({
  depth,
  className,
  children,
}: {
  depth: number;
  className?: string;
  children: React.ReactNode;
}) {
  const style = useRowStyle(depth);

  return (
    <div
      style={style}
      className={cn(
        "text-muted-foreground flex h-7 items-center gap-1.5 pr-2 text-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
