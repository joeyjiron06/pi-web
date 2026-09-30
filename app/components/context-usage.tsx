import { useMemo } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/ui/hover-card";
import { cn } from "~/lib/utils";
import { useSessionStats } from "~/store/selectors";

const numberFormat = new Intl.NumberFormat();

// pi reports cost in USD, and a short session can easily land under a cent, so
// two decimals alone would round most sessions to "$0.00"
const costFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function TokenUsageRing({ percent }: { percent: number | null }) {
  const radius = 7;

  const { circumference, dashOffset } = useMemo(() => {
    const circumference = 2 * Math.PI * radius;
    const clampedPercent = Math.min(Math.max(percent ?? 0, 0), 100);

    return {
      circumference,
      dashOffset: circumference - (clampedPercent / 100) * circumference,
    };
  }, [percent]);

  return (
    <svg className="size-4" viewBox="0 0 20 20">
      <circle
        className="stroke-muted-foreground/25"
        cx="10"
        cy="10"
        fill="none"
        r={radius}
        strokeWidth="2.5"
      />
      <circle
        className="stroke-primary"
        cx="10"
        cy="10"
        fill="none"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth="2.5"
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

/**
 * Context window usage for a session, as a ring that fills up.
 *
 * Reads the store itself rather than taking the usage as a prop so that stats
 * updates (which arrive after every assistant message) don't re-render the
 * whole session page.
 */
export default function ContextUsage({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const stats = useSessionStats(sessionId);
  const contextUsage = stats?.contextUsage;

  // pi reports `percent: null` when it can't be trusted -- right after a
  // compaction, until the next assistant response lands. Showing "0%" there
  // would be a lie, so the label falls back to an em dash.
  const percentLabel = useMemo(
    () =>
      contextUsage?.percent == null
        ? "—"
        : `${Math.round(contextUsage.percent)}%`,
    [contextUsage?.percent],
  );

  const tokensLabel = useMemo(
    () =>
      contextUsage?.tokens == null
        ? "unknown"
        : numberFormat.format(contextUsage.tokens),
    [contextUsage?.tokens],
  );

  const contextWindowLabel = useMemo(
    () => (contextUsage ? numberFormat.format(contextUsage.contextWindow) : ""),
    [contextUsage],
  );

  const costLabel = useMemo(
    () => (stats ? costFormat.format(stats.cost) : ""),
    [stats],
  );

  // undefined when the session has no model, or a model with no declared
  // context window -- there is nothing meaningful to show
  if (!contextUsage) {
    return null;
  }

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={100}
        // renders an <a> by default; a plain button keeps it focusable and
        // `type="button"` stops it submitting the surrounding prompt form
        render={<button type="button" />}
        className={cn(
          "group flex cursor-default items-center gap-1.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <span className="tabular-nums">{percentLabel}</span>
        <TokenUsageRing percent={contextUsage.percent} />
      </HoverCardTrigger>

      <HoverCardContent side="top" align="end" className="w-56">
        <div className="flex flex-col gap-1">
          <div className="font-medium text-foreground">Context usage</div>
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>Used</span>
            <span className="text-foreground">{tokensLabel}</span>
          </div>
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>Context window</span>
            <span className="text-foreground">{contextWindowLabel}</span>
          </div>
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>Cost</span>
            <span className="text-foreground">{costLabel}</span>
          </div>
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>Percent used</span>
            <span className="text-foreground">{percentLabel}</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
