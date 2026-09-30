import { ClockArrowDownIcon, CornerDownRightIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFetcher } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useFollowUpQueue, useSteeringQueue } from "~/store/selectors";
import type { SessionPromptResult } from "~/routes/session/session.types";

/**
 * Messages the user submitted while the agent was still working, waiting in one
 * of pi's two queues.
 *
 * - **Steer**: delivered once the current assistant turn finishes its tool
 *   calls, before the next LLM call.
 * - **Follow-up**: delivered only once the agent would otherwise stop.
 *
 * Rendered by the session page inside the composer's container, which is a
 * `shrink-0` sibling of the scrolling transcript -- so this sits above the
 * prompt area and stays put while the conversation scrolls. No fixed
 * positioning needed.
 */
type QueueKind = "steer" | "followUp";

type QueuedRow = {
  key: string;
  text: string;
  kind: QueueKind;
};

export default function QueuedMessages({
  sessionId,
  onRestore,
}: {
  sessionId: string;
  /**
   * Hands back the messages a clear pulled out of the queue, so the page can
   * put them in the composer. Clearing is not allowed to destroy text the user
   * typed.
   */
  onRestore: (messages: string[]) => void;
}) {
  // Both come back by reference (or undefined) -- see the selectors. Never
  // default them to `[]` inline, that would be a new array on every read.
  const steering = useSteeringQueue(sessionId);
  const followUp = useFollowUpQueue(sessionId);

  const fetcher = useFetcher<SessionPromptResult>();

  /**
   * Steering first, then follow-up: the same order pi delivers them in.
   *
   * Keys are positional because pi's queue is a bare `string[]` with no ids,
   * and two identical messages are genuinely indistinguishable. Safe here
   * because rows are only ever appended at the end and removed from the front.
   */
  const rows = useMemo<QueuedRow[]>(() => {
    const result: QueuedRow[] = [];

    steering?.forEach((text, index) => {
      result.push({ key: `steer-${index}`, text, kind: "steer" });
    });

    followUp?.forEach((text, index) => {
      result.push({ key: `followup-${index}`, text, kind: "followUp" });
    });

    return result;
  }, [steering, followUp]);

  const handleClear = useCallback(() => {
    // A fetcher, not the page's <Form>, for three reasons: the form is
    // multipart and would re-upload every staged attachment, the page clears
    // the draft on any non-abort form submission, and `actionData` needs to
    // keep meaning "the last prompt result" for the error toast.
    fetcher.submit({ intent: "clear-queue" }, { method: "post" });
  }, [fetcher]);

  /**
   * The fetcher's result never reaches the page's `actionData`, so the restore
   * has to be driven from here.
   *
   * Guarded by identity, like the page's own restore effect: `fetcher.data`
   * persists after the submission settles, and without the ref every unrelated
   * re-render would prepend the same text again.
   */
  const appliedRestoreRef = useRef<unknown>(null);
  const fetcherData = fetcher.data;

  useEffect(() => {
    if (!fetcherData?.ok || !fetcherData.restored?.length) return;
    if (appliedRestoreRef.current === fetcherData) return;

    appliedRestoreRef.current = fetcherData;
    onRestore(fetcherData.restored);
  }, [fetcherData, onRestore]);

  // A boolean check, so no useMemo
  const isClearing = fetcher.state !== "idle";

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {rows.length} queued
        </span>

        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={handleClear}
          disabled={isClearing}
        >
          <XIcon />
          Clear queue
        </Button>
      </div>

      {/* A queue is unbounded, so it gets a cap and its own scroll rather than
          being allowed to push the composer off the screen. */}
      <ul className="border-border flex max-h-[30vh] flex-col gap-1 overflow-y-auto border-l-2 pl-2">
        {rows.map((row) => (
          <QueuedRowItem key={row.key} row={row} />
        ))}
      </ul>
    </div>
  );
}

function QueuedRowItem({ row }: { row: QueuedRow }) {
  const isSteer = row.kind === "steer";

  return (
    <li className="flex items-start justify-between gap-2">
      {/* min-w-0 is load-bearing: without it a long unbroken message refuses to
          shrink and pushes the badge out of the row. */}
      <span className="text-muted-foreground min-w-0 flex-1 line-clamp-2 text-xs break-words">
        {row.text}
      </span>

      <Badge variant="outline" className="shrink-0">
        {isSteer ? <CornerDownRightIcon /> : <ClockArrowDownIcon />}
        {isSteer ? "Steer" : "Follow-up"}
      </Badge>
    </li>
  );
}
