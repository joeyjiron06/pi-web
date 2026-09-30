import type { Api, Model } from "@earendil-works/pi-ai";
import { toModelRef } from "~/lib/model-ref";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

type Props = {
  /** canonical `provider/id` ref, see `~/lib/model-ref` */
  modelRef: string;
  models: readonly Model<Api>[];
  onModelChanged: (modelRef: string) => void;
};

export default function ModelPicker({
  modelRef,
  models,
  onModelChanged,
}: Props) {
  return (
    <Select
      value={modelRef}
      disabled={models.length === 0}
      onValueChange={(nextModelRef) => {
        if (nextModelRef !== null) {
          onModelChanged(nextModelRef);
        }
      }}
    >
      <SelectTrigger aria-label="Model" size="sm" className="max-w-72 w-fit">
        <SelectValue placeholder="Select a model">
          {(selectedModelRef: string | null) =>
            models.find((model) => toModelRef(model) === selectedModelRef)?.name
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="w-56" align="start" side="top">
        <SelectGroup>
          {/* keyed by ref, not id: the same id can appear under two providers,
              which would otherwise collide as a React key and a Select value */}
          {models.map((model) => (
            <SelectItem key={toModelRef(model)} value={toModelRef(model)}>
              <span>{model.name}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {formatContextWindow(model.contextWindow)}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function formatContextWindow(contextWindow: number) {
  if (contextWindow >= 1_000_000) {
    const millions = Math.floor(contextWindow / 100_000) / 10;
    return `${millions.toFixed(1).replace(/\.0$/, "")} M`;
  }

  if (contextWindow >= 1_000) {
    return `${Math.floor(contextWindow / 1_000)} K`;
  }

  return contextWindow.toLocaleString();
}
