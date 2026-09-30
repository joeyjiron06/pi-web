export type ParsedSkillBlock = {
  name: string;
  location: string;
  content: string;
  userMessage: string | undefined;
};

const SKILL_BLOCK =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/**
 * Client-safe copy of `parseSkillBlock` from `@earendil-works/pi-coding-agent`.
 *
 * Importing it from the package pulls the whole agent (and its node-only deps
 * like cross-spawn) into the browser bundle, which throws
 * `process is not defined` and kills hydration. The upstream implementation is
 * this one regex, so it's duplicated here instead.
 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(SKILL_BLOCK);
  if (!match) return null;

  return {
    name: match[1] ?? "",
    location: match[2] ?? "",
    content: match[3] ?? "",
    userMessage: match[4]?.trim() || undefined,
  };
}
