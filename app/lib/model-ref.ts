import type { Api, Model } from "@earendil-works/pi-ai";

/**
 * A model's identity in pi is the *pair* (provider, id), not the id alone --
 * the same id is exposed by more than one provider (e.g. `claude-opus-5` under
 * both `anthropic` and `github-copilot`). A bare id is therefore ambiguous as a
 * `<Select>` value, as a React key, and as a form field.
 *
 * So the UI carries a single opaque "model ref" string, `provider/id`, which is
 * also pi's own canonical reference format.
 *
 * Lives in `~/lib` (not `models.server.ts`) because the pickers are client
 * components: they can't import a `.server` module, and keeping encode next to
 * decode stops the two halves drifting apart.
 */
export type ModelRef = {
  provider: string;
  id: string;
};

export function toModelRef(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Split on the *first* slash only: several providers put slashes inside the
 * model id itself (OpenRouter's `anthropic/claude-sonnet-4`), so
 * `openrouter/anthropic/claude-sonnet-4` has to resolve to
 * provider `openrouter` + id `anthropic/claude-sonnet-4`.
 *
 * Returns null for anything that isn't a well formed ref, so callers are forced
 * to handle it rather than silently building a `{ provider: "" }` that matches
 * no model.
 */
export function parseModelRef(ref: string): ModelRef | null {
  const separator = ref.indexOf("/");

  // <= 0 covers both "no slash" and a leading slash (empty provider)
  if (separator <= 0) return null;

  const provider = ref.slice(0, separator);
  const id = ref.slice(separator + 1);

  if (!id) return null;

  return { provider, id };
}

/** Cheap shape check for validation, without allocating the parsed object. */
export function isModelRef(ref: string): boolean {
  return parseModelRef(ref) !== null;
}
