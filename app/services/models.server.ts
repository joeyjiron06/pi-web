import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  ModelRegistry,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import cache from "~/services/cache.server";
import { THINKING_LEVELS } from "~/routes/home/home.types";

export async function getModels(): Promise<Model<Api>[]> {
  return cache.wrap(`models`, async () => {
    const modelRuntime = await ModelRuntime.create();
    const modelRegistry = new ModelRegistry(modelRuntime);
    const models = modelRegistry.getAvailable();
    return models;
  });
}

export type ModelDefaults = {
  /** canonical `provider/id` ref, see `~/lib/model-ref` */
  modelRef?: string;
  thinkingLevel?: ThinkingLevel;
};

/**
 * The user's saved defaults, read from the same settings.json the terminal app
 * uses. Deliberately *global* settings only: `cwd` is this server's own repo,
 * not the project the user is about to pick, so its project settings must not
 * leak into the homepage.
 *
 * Not cached -- it's a cheap sync file read, and caching would hide settings
 * edits until the server restarts.
 */
export function getModelDefaults(): ModelDefaults {
  // agentDir is passed explicitly so PI_AGENT_DIR is honoured
  const settings = SettingsManager.create(process.cwd(), getAgentDir());
  const { defaultProvider, defaultModel, defaultThinkingLevel } =
    settings.getGlobalSettings();

  // pi's settings type also allows "off", which this UI has no representation
  // for, so anything outside our own list is treated as "not set".
  const thinkingLevel = THINKING_LEVELS.find(
    (level) => level === defaultThinkingLevel,
  );

  // both halves are needed to identify a model. settings written by an older
  // pi (or hand-edited) can have `defaultModel` without `defaultProvider`; the
  // id alone is ambiguous, so treat that as "no default" and let the user pick
  // rather than guessing a provider for them.
  const modelRef =
    defaultProvider && defaultModel
      ? `${defaultProvider}/${defaultModel}`
      : undefined;

  return { modelRef, thinkingLevel };
}
