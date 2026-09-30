import { FILE_REFERENCE_PATTERN } from "~/lib/attachments";
import { parseSkillBlock } from "~/lib/skill-block";

export type UserMessageTextSegment =
  | { type: "skill"; name: string }
  | { type: "file"; relativePath: string; name: string }
  | { type: "fileRef"; path: string; name: string; size: string }
  | { type: "text"; text: string };

/**
 * A file mention as the prompt input writes it: `@` at the start of a word,
 * followed by a run of non-whitespace.
 *
 * The leading group keeps the boundary (start of string or whitespace) out of
 * the path *and* stops `joey@example.com` from being read as a mention.
 *
 * Known limit: paths containing spaces can't be represented in plain text, so
 * `@my file.ts` parses as the mention `my` followed by the text ` file.ts`.
 */
const FILE_MENTION = /(^|\s)@(\S+)/g;

/** Punctuation that ends a sentence rather than a path. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"`]+$/;

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Splits `@mentions` out of a run of plain text. */
function parseMentions(text: string): UserMessageTextSegment[] {
  const segments: UserMessageTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(FILE_MENTION)) {
    const [whole, boundary = "", rawPath = ""] = match;
    const start = match.index;

    const relativePath = rawPath.replace(TRAILING_PUNCTUATION, "");

    // `@` on its own, or `@...` that was entirely punctuation: not a mention
    if (!relativePath) continue;

    segments.push({
      type: "text",
      text: text.slice(lastIndex, start) + boundary,
    });
    segments.push({
      type: "file",
      relativePath,
      name: basename(relativePath),
    });

    lastIndex = start + whole.length - (rawPath.length - relativePath.length);
  }

  segments.push({ type: "text", text: text.slice(lastIndex) });

  return segments;
}

/**
 * Splits the text of a user message into renderable segments.
 *
 * Runs in three passes, because the things being parsed are nested:
 *
 * 1. The agent rewrites a `/skill:<name>` prompt into a `<skill>` block
 *    followed by whatever the user actually typed, so the skill is peeled off
 *    first.
 * 2. `<file name="..." size="...">` references, appended by the server for
 *    every non-image attachment, are lifted out next. This happens before
 *    mentions so that a path inside a reference can never be re-parsed as
 *    something else, and so the raw markup never reaches the screen.
 * 3. Mentions are parsed out of the plain text left between them.
 */
export function parseUserMessageSegments(
  text: string,
): UserMessageTextSegment[] {
  const segments: UserMessageTextSegment[] = [];

  // pass 1: skill
  const skillBlock = parseSkillBlock(text);
  const remaining = skillBlock ? (skillBlock.userMessage ?? "") : text.trim();

  if (skillBlock) {
    segments.push({ type: "skill", name: skillBlock.name });
  }

  // pass 2: attachment references.
  // A fresh regex per call: the shared constant carries `g`, and reusing a
  // stateful regex across calls is a classic source of skipped matches.
  const references = new RegExp(FILE_REFERENCE_PATTERN.source, "g");
  let lastIndex = 0;

  for (const match of remaining.matchAll(references)) {
    const [whole, path = "", size = ""] = match;

    // pass 3 runs on the text between references
    segments.push(...parseMentions(remaining.slice(lastIndex, match.index)));
    segments.push({
      type: "fileRef",
      path,
      name: basename(path),
      size,
    });

    lastIndex = match.index + whole.length;
  }

  segments.push(...parseMentions(remaining.slice(lastIndex)));

  // `!== ""` rather than a trim check: a whitespace-only run between two
  // mentions is meaningful, and dropping it would visually weld them together.
  return segments.filter(
    (segment) => segment.type !== "text" || segment.text !== "",
  );
}
