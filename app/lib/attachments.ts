/**
 * Shared vocabulary for prompt attachments.
 *
 * Deliberately isomorphic: the drop handler, the composer and the route action
 * all agree on the same limits and the same `<file>` reference syntax, so a
 * rule can't drift between the browser and the server.
 */

/** Form field the hidden file input submits under. */
export const ATTACHMENT_FIELD_NAME = "attachments";

/** Most attachments allowed on a single prompt. */
export const MAX_ATTACHMENTS = 10;

/** Largest single file accepted, before any resizing. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Largest combined upload accepted for one submission. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/**
 * The only image formats pi can put in an `ImageContent` block. Anything else
 * (HEIC from an iPhone, AVIF, SVG, TIFF) is rejected at drop time rather than
 * silently dropped by the provider later.
 */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

/** Extensions used when the browser hands us a file with no `type`. */
const IMAGE_EXTENSIONS: Record<string, SupportedImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export type ImageAttachment = {
  kind: "image";
  id: string;
  file: File;
  name: string;
  size: number;
  /** Object URL for the composer thumbnail. Revoked when the attachment goes. */
  previewUrl: string;
};

export type FileAttachment = {
  kind: "file";
  id: string;
  file: File;
  name: string;
  size: number;
  /** MIME type as the browser reported it; only used to pick an icon. */
  type: string;
};

export type Attachment = ImageAttachment | FileAttachment;

export type ClassifiedFile =
  | { kind: "image"; mimeType: SupportedImageMimeType }
  | { kind: "file" }
  | { kind: "rejected"; reason: string };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Decide what a dropped file is, from the browser's point of view.
 *
 * This is a *hint*, not a security boundary: `file.type` comes from the client
 * and the server re-sniffs the bytes. Its job is to give the user an immediate,
 * accurate answer instead of a failure after a 25 MB upload.
 */
export function classifyFile(file: File): ClassifiedFile {
  if (file.size === 0) {
    return { kind: "rejected", reason: `"${file.name}" is empty` };
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      kind: "rejected",
      reason: `"${file.name}" is ${formatFileSize(file.size)}. The limit is ${formatFileSize(MAX_ATTACHMENT_BYTES)}`,
    };
  }

  const declared = file.type.split(";")[0]?.trim().toLowerCase() ?? "";

  if (isSupportedImageMimeType(declared)) {
    return { kind: "image", mimeType: declared };
  }

  // Some sources (Finder, certain Linux file managers) hand over an empty
  // `type`, so fall back to the extension before giving up on an image.
  const byExtension = IMAGE_EXTENSIONS[extensionOf(file.name)];
  if (!declared && byExtension) {
    return { kind: "image", mimeType: byExtension };
  }

  // A format the user clearly *means* as an image, but pi can't send. Say so,
  // rather than attaching it as an opaque blob they'll wonder about.
  if (declared.startsWith("image/")) {
    return {
      kind: "rejected",
      reason: `"${file.name}" is ${declared}, which can't be sent to a model. Use PNG, JPEG, GIF or WebP`,
    };
  }

  return { kind: "file" };
}

export function isSupportedImageMimeType(
  value: string,
): value is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Reduce a client-supplied filename to something safe to write to disk.
 *
 * Every path separator, traversal segment, control character and quote is
 * removed: the quote matters because the name is embedded in a
 * `<file name="...">` attribute, and a stray one would let a filename forge a
 * second attribute.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";

  const cleaned = base
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["'<>|:*?]/g, "")
    .replace(/^\.+/, "")
    .trim();

  if (!cleaned) return "attachment";

  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

/** Matches the `<file>` references the server appends to a prompt. */
export const FILE_REFERENCE_PATTERN =
  /<file name="([^"]*)" size="([^"]*)">([\s\S]*?)<\/file>/g;

/**
 * Render one attachment reference for the agent.
 *
 * The shape mirrors pi's own `@file` CLI expansion so the model sees a
 * convention it already understands, and so the transcript can parse it back
 * out into a card instead of showing raw markup.
 */
export function formatFileReference(
  absolutePath: string,
  sizeBytes: number,
): string {
  return `<file name="${absolutePath}" size="${formatFileSize(sizeBytes)}">The user attached this file. It is saved on disk at the path above; use your tools to read it.</file>`;
}
