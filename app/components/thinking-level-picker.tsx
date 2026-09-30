import type { ThinkingLevel } from "@earendil-works/pi-ai";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

type Props = {
  thinkingLevels: readonly ThinkingLevel[];
  thinkingLevel: ThinkingLevel;
  onThinkingLevelChanged: (thinkingLevel: ThinkingLevel) => void;
};

export default function ThinkingLevelPicker({
  thinkingLevels,
  thinkingLevel,
  onThinkingLevelChanged,
}: Props) {
  return (
    <Select
      value={thinkingLevel}
      disabled={thinkingLevels.length === 0}
      onValueChange={(nextThinkingLevel) => {
        if (nextThinkingLevel !== null) {
          onThinkingLevelChanged(nextThinkingLevel as ThinkingLevel);
        }
      }}
    >
      <SelectTrigger
        aria-label="Thinking Level"
        size="sm"
        className="max-w-72 w-fit"
      >
        <SelectValue placeholder="No thinking available">
          {(selectedThinkingLevel: string | null) => selectedThinkingLevel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" side="top">
        <SelectGroup>
          {thinkingLevels.map((level) => (
            <SelectItem key={level} value={level}>
              <span>{level}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
