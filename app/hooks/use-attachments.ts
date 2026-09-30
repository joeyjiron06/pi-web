import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "~/components/ui/toast";
import {
  classifyFile,
  MAX_ATTACHMENTS,
  type Attachment,
} from "~/lib/attachments";

function revoke(attachment: Attachment) {
  if (attachment.kind === "image") URL.revokeObjectURL(attachment.previewUrl);
}

/**
 * Owns the attachments staged in the composer.
 *
 * Object URLs are created when a file is accepted and revoked when it leaves,
 * including on unmount. Without that, every dropped screenshot leaks its bytes
 * for the life of the tab.
 *
 * All the decisions happen in the event handler rather than inside a state
 * updater: updaters must stay pure, and React invokes them twice in StrictMode,
 * which would double every toast and re-revoke every URL.
 */
export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  /**
   * Authoritative copy for the handlers below. Reading state directly would go
   * stale when two drops land in the same tick, which is exactly what happens
   * when a user drops a batch and immediately drops another.
   */
  const attachmentsRef = useRef<Attachment[]>(attachments);

  const commit = useCallback((next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(revoke);
    };
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const current = attachmentsRef.current;
      const rejections: string[] = [];
      const candidates: Attachment[] = [];

      for (const file of files) {
        const classified = classifyFile(file);

        if (classified.kind === "rejected") {
          rejections.push(classified.reason);
          continue;
        }

        const id = crypto.randomUUID();

        candidates.push(
          classified.kind === "image"
            ? {
                kind: "image",
                id,
                file,
                name: file.name,
                size: file.size,
                previewUrl: URL.createObjectURL(file),
              }
            : {
                kind: "file",
                id,
                file,
                name: file.name,
                size: file.size,
                type: file.type,
              },
        );
      }

      const room = Math.max(0, MAX_ATTACHMENTS - current.length);
      const kept = candidates.slice(0, room);
      const overflow = candidates.slice(room);

      // These never reach state, so the unmount cleanup would never see them.
      overflow.forEach(revoke);

      for (const reason of rejections) {
        toast.add({
          title: "Couldn't attach",
          description: reason,
          type: "error",
        });
      }

      if (overflow.length > 0) {
        toast.add({
          title:
            kept.length > 0 ? "Some files weren't attached" : "Couldn't attach",
          description: `You can attach up to ${MAX_ATTACHMENTS} files`,
          type: "error",
        });
      }

      if (kept.length > 0) commit([...current, ...kept]);
    },
    [commit],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const current = attachmentsRef.current;
      const target = current.find((attachment) => attachment.id === id);

      if (!target) return;

      revoke(target);
      commit(current.filter((attachment) => attachment.id !== id));
    },
    [commit],
  );

  const clearAttachments = useCallback(() => {
    const current = attachmentsRef.current;
    if (current.length === 0) return;

    current.forEach(revoke);
    commit([]);
  }, [commit]);

  return { attachments, addFiles, removeAttachment, clearAttachments };
}
