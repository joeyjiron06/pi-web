import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks a file drag over the whole window and hands the dropped files back.
 *
 * Three details make this less trivial than it looks:
 *
 * - `dragleave` fires every time the pointer crosses *any* element boundary,
 *   including into a child, so a naive listener flickers. A depth counter of
 *   enter/leave pairs is the standard fix.
 * - `dragover` must call `preventDefault()`, otherwise the browser treats the
 *   drop as a navigation and replaces the page with the file. On a session page
 *   that would throw away the composer mid-conversation.
 * - dragging text inside the contentEditable editor also fires drag events. We
 *   only react when the payload actually contains files.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);

  // The listeners are bound once; routing through a ref keeps a caller's
  // inline handler from re-subscribing them on every render.
  const onFilesRef = useRef(onFiles);
  const depthRef = useRef(0);

  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const carriesFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const handleEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depthRef.current += 1;
      setIsDragging(true);
    };

    const handleOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Required for `drop` to fire at all.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const handleLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depthRef.current -= 1;
      if (depthRef.current <= 0) reset();
    };

    const handleDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Prevent the navigation even if the drop lands outside any target.
      event.preventDefault();
      reset();

      const transfer = event.dataTransfer;
      if (!transfer) return;

      // A dropped *folder* arrives as an item with no usable file behind it.
      // `webkitGetAsEntry` is the only way to tell before reading it, and the
      // items list has to be inspected before the event finishes.
      const directoryFlags = Array.from(transfer.items ?? []).map(
        (item) => item.webkitGetAsEntry?.()?.isDirectory ?? false,
      );

      const files = Array.from(transfer.files).filter(
        (_, index) => !directoryFlags[index],
      );

      if (files.length > 0) onFilesRef.current(files);
    };

    window.addEventListener("dragenter", handleEnter);
    window.addEventListener("dragover", handleOver);
    window.addEventListener("dragleave", handleLeave);
    window.addEventListener("drop", handleDrop);
    // A drag that ends outside the window never sends `dragleave`.
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);

    return () => {
      window.removeEventListener("dragenter", handleEnter);
      window.removeEventListener("dragover", handleOver);
      window.removeEventListener("dragleave", handleLeave);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, [reset]);

  return isDragging;
}
