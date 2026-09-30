import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { useCallback, useState } from "react";
import { data } from "react-router";
import PromptInput from "~/components/prompt-input";
import { getModelDefaults, getModels } from "~/services/models.server";
import type { Route } from "./+types/prompt";

/**
 * Demo harness for `~/components/prompt-input`. Not wired to a session:
 * submitting only logs the FormData the real routes would receive.
 */
export async function loader() {
  const defaults = getModelDefaults();
  const cwd = process.cwd();

  return data({
    // streamed, exactly like the home/session loaders do it
    modelsPromise: getModels(),
    cwd,
    defaultModelRef: defaults.modelRef ?? "",
    defaultThinkingLevel: defaults.thinkingLevel ?? ("medium" as ThinkingLevel),
  });
}

export default function Prompt({ loaderData }: Route.ComponentProps) {
  const { modelsPromise, cwd, defaultModelRef, defaultThinkingLevel } =
    loaderData;
  const [text, setText] = useState("");
  const [modelRef, setModelRef] = useState(defaultModelRef);
  const [thinkingLevel, setThinkingLevel] =
    useState<ThinkingLevel>(defaultThinkingLevel);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      console.log(
        "submitted",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      setText("");
    },
    [],
  );

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl">
        <PromptInput
          className="rounded-card"
          text={text}
          onTextChanged={setText}
          modelRef={modelRef}
          modelsPromise={modelsPromise as Promise<Model<Api>[]>}
          onModelChanged={setModelRef}
          thinkingLevel={thinkingLevel}
          thinkingLevelChanged={setThinkingLevel}
          cwd={cwd}
        />
      </form>
    </main>
  );
}
