import { FileTextIcon, ImageIcon, FileIcon } from "lucide-react";

type FileDropOverlayProps = {
  /** Whether a file is currently being dragged over the window. */
  isDragging: boolean;
};

/**
 * Full-window prompt shown while a file is dragged over the page.
 *
 * Two deliberate choices:
 *
 * - It mounts and unmounts rather than fading, so the `aria-live` region
 *   actually announces. A region that is always mounted with static text
 *   announces nothing.
 * - `pointer-events-none` is load-bearing, not cosmetic. The drop is handled by
 *   window listeners (see `useFileDrop`), and an overlay that accepted pointer
 *   events would insert itself between the cursor and the page, firing a
 *   `dragleave` storm the moment it appeared.
 */
export function FileDropOverlay({ isDragging }: FileDropOverlayProps) {
  if (!isDragging) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      data-test-id="file-drop-overlay"
    >
      <div
        className="border-border bg-card flex flex-col items-center gap-3 border border-dashed px-10 py-8"
        role="status"
        aria-live="polite"
      >
        <div className="text-muted-foreground flex items-end gap-2">
          <FileTextIcon className="size-8 -rotate-12" />
          <ImageIcon className="size-10" />
          <FileIcon className="size-8 rotate-12" />
        </div>

        <div className="flex flex-col items-center gap-1">
          <p className="text-lg font-semibold tracking-tight">Add anything</p>
          <p className="text-muted-foreground text-sm">
            Drop files here to add it to the conversation
          </p>
        </div>
      </div>
    </div>
  );
}
