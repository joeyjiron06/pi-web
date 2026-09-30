import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  formatDimensionNote,
  resizeImage,
} from "@earendil-works/pi-coding-agent";
import {
  formatFileReference,
  isSupportedImageMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  sanitizeFileName,
  type SupportedImageMimeType,
} from "~/lib/attachments";

/** Root for every non-image attachment written to disk. */
const ATTACHMENTS_ROOT = join(tmpdir(), "pi-web-attachments");

/** Folders older than this are swept on server start. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Resizes are CPU-bound WASM work in a worker thread. Two at a time keeps a
 * batch of images moving without spawning ten workers for one submission.
 */
const RESIZE_CONCURRENCY = 2;

/** A wedged resize must not hold the POST open forever. */
const RESIZE_TIMEOUT_MS = 30_000;

export type PreparedAttachments = {
  /** Ready to hand to `session.prompt({ images })`. */
  images: ImageContent[];
  /**
   * `<file>` references for everything written to disk, newline separated.
   * Empty when there were none.
   */
  fileReferencesText: string;
  /** Human-readable problems, for surfacing back to the user. */
  errors: string[];
};

/**
 * Identify an image from its bytes.
 *
 * pi exports a path-based sniffer but not a buffer-based one, and we hold the
 * upload in memory, so the magic-byte checks are repeated here. The client's
 * `file.type` is never trusted: it is trivially forged and often just wrong.
 */
function sniffImageMimeType(bytes: Uint8Array): SupportedImageMimeType | null {
  const startsWith = (offset: number, ...expected: number[]) =>
    expected.every((byte, index) => bytes[offset + index] === byte);

  const ascii = (offset: number, text: string) =>
    [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

  // JPEG. 0xFFD8FFF7 is lossless JPEG, which decoders in this chain reject.
  if (startsWith(0, 0xff, 0xd8, 0xff)) {
    return bytes[3] === 0xf7 ? null : "image/jpeg";
  }

  if (startsWith(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }

  if (ascii(0, "GIF8")) {
    return "image/gif";
  }

  if (ascii(0, "RIFF") && ascii(8, "WEBP")) {
    return "image/webp";
  }

  return null;
}

/**
 * pi's own `processImage` is not reachable: the package `exports` map only
 * publishes the root entry, and `processImage` is not re-exported from it. This
 * is the same pipeline rebuilt on the pieces that *are* exported, so our images
 * get the identical treatment to the TUI's: EXIF rotation, a 2000x2000 cap, a
 * 4.5 MB base64 cap, and a note telling the model how to map coordinates back
 * onto the original.
 */
async function processImage(
  bytes: Uint8Array,
  mimeType: SupportedImageMimeType,
  fileName: string,
): Promise<{ image: ImageContent; hint?: string } | { error: string }> {
  let resized;

  try {
    resized = await Promise.race([
      resizeImage(bytes, mimeType),
      new Promise<null>((_, reject) =>
        setTimeout(
          () => reject(new Error("timed out")),
          RESIZE_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);
  } catch (error) {
    return {
      error: `Couldn't process "${fileName}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // null means Photon could not load, or the image could not be squeezed under
  // the size cap. Either way it must not be sent: an oversized image poisons
  // every later request in the conversation, not just this turn.
  if (!resized) {
    return {
      error: `Couldn't process "${fileName}". It may be corrupt, or too large to fit the model's image limit`,
    };
  }

  return {
    image: {
      type: "image",
      data: resized.data,
      mimeType: resized.mimeType,
    },
    hint: formatDimensionNote(resized),
  };
}

/** Run `task` over `items`, at most `limit` at a time, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await task(items[index]!, index);
      }
    })(),
  );

  await Promise.all(workers);

  return results;
}

function sessionAttachmentsDir(sessionId: string): string {
  // The id comes from pi, not from the URL, but it still ends up in a path, so
  // it is reduced to characters that cannot traverse out of the root.
  return join(ATTACHMENTS_ROOT, sessionId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

/**
 * Turn the uploaded files into something `session.prompt()` accepts.
 *
 * Every limit is re-checked here even though the browser already checked it:
 * the browser is just a client, and `session.prompt()` itself validates
 * nothing at all.
 */
export async function prepareAttachments(
  files: File[],
  sessionId: string,
): Promise<PreparedAttachments> {
  const errors: string[] = [];

  if (files.length === 0) {
    return { images: [], fileReferencesText: "", errors };
  }

  let accepted = files;

  if (accepted.length > MAX_ATTACHMENTS) {
    errors.push(
      `Only the first ${MAX_ATTACHMENTS} attachments were sent; the rest were dropped`,
    );
    accepted = accepted.slice(0, MAX_ATTACHMENTS);
  }

  const totalBytes = accepted.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return {
      images: [],
      fileReferencesText: "",
      errors: [
        `Attachments total ${Math.round(totalBytes / 1024 / 1024)} MB, over the ${Math.round(MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024)} MB limit`,
      ],
    };
  }

  const oversized = accepted.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
  for (const file of oversized) {
    errors.push(`"${file.name}" is too large and was skipped`);
  }
  accepted = accepted.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);

  // Read once; both branches below need the bytes.
  const loaded = await Promise.all(
    accepted.map(async (file) => ({
      file,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );

  const imageCandidates: { file: File; bytes: Uint8Array; mimeType: SupportedImageMimeType }[] = [];
  const diskCandidates: { file: File; bytes: Uint8Array }[] = [];

  for (const entry of loaded) {
    const sniffed = sniffImageMimeType(entry.bytes);

    if (sniffed && isSupportedImageMimeType(sniffed)) {
      imageCandidates.push({ ...entry, mimeType: sniffed });
      continue;
    }

    // Claimed to be an image but isn't one we can send. Saving it to disk is
    // still useful (the agent can run tooling on it) and beats a silent drop.
    diskCandidates.push(entry);
  }

  const processed = await mapWithConcurrency(
    imageCandidates,
    RESIZE_CONCURRENCY,
    (candidate) =>
      processImage(candidate.bytes, candidate.mimeType, candidate.file.name),
  );

  const images: ImageContent[] = [];
  const references: string[] = [];

  for (const result of processed) {
    if ("error" in result) {
      errors.push(result.error);
      continue;
    }

    images.push(result.image);
  }

  if (diskCandidates.length > 0) {
    const dir = sessionAttachmentsDir(sessionId);

    for (const { file, bytes } of diskCandidates) {
      try {
        const folder = join(dir, randomUUID());
        await mkdir(folder, { recursive: true });

        const absolutePath = join(folder, sanitizeFileName(file.name));
        await writeFile(absolutePath, bytes);

        references.push(formatFileReference(absolutePath, file.size));
      } catch (error) {
        errors.push(
          `Couldn't save "${file.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return {
    images,
    fileReferencesText: references.join("\n"),
    errors,
  };
}

/**
 * Drop everything written for a session. Called when a session is closed, so
 * attachments don't outlive the conversation that referenced them.
 */
export async function deleteSessionAttachments(
  sessionId: string,
): Promise<void> {
  await rm(sessionAttachmentsDir(sessionId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
}

/**
 * Remove attachment folders left behind by sessions that were never closed --
 * a killed server, a crash, a machine reboot. Runs once at startup, best
 * effort, and never throws into the boot path.
 */
export async function sweepStaleAttachments(): Promise<void> {
  let entries: string[];

  try {
    entries = await readdir(ATTACHMENTS_ROOT);
  } catch {
    // No root yet: nothing has ever been attached.
    return;
  }

  const cutoff = Date.now() - STALE_AFTER_MS;

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(ATTACHMENTS_ROOT, entry);

      try {
        const info = await stat(path);
        if (info.mtimeMs < cutoff) {
          await rm(path, { recursive: true, force: true });
        }
      } catch {
        // A folder that vanished under us needs no cleaning.
      }
    }),
  );
}
