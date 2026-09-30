import { startOfTomorrow } from "date-fns";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useCookie } from "~/hooks/use-cookie";
import { canCopyToClipboard, copyToClipboard } from "~/lib/copy-to-clipboard";
import type { UpdateCheckResult } from "~/routes/updates";
import { Button } from "./ui/button";
import { toast } from "./ui/toast";

/** Cleared by the browser at local midnight, so "dismissed" lasts one day. */
const DISMISS_COOKIE = "piUpdateDismissed";

/** Stable id: re-adding with the same id updates in place instead of stacking. */
const TOAST_ID = "pi-sdk-update";

/** How long the copied checkmark stays up. */
const COPIED_TIMEOUT_MS = 2000;

/**
 * The toast body: the version jump and the command that performs it.
 *
 * A real component rather than inline JSX so it can own the "copied" state.
 * `toast.add` captures the element once, but React still mounts it normally,
 * so local state works as usual.
 *
 * **Every element here must be phrasing content.** base-ui renders
 * `Toast.Description` as a `<p>`, and the HTML parser closes a `<p>` as soon
 * as it meets a `<div>`, which would move this content out of the toast.
 * Hence `<span>` with flex classes rather than `<div>`.
 */
function UpdateToastBody({
  current,
  latest,
  command,
}: {
  current: string;
  latest: string;
  command: string;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimeout = useRef<number>(0);

  const canCopy = useMemo(() => canCopyToClipboard(), []);

  useEffect(() => () => window.clearTimeout(copiedTimeout.current), []);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(command);
    if (!ok) return;

    setCopied(true);
    window.clearTimeout(copiedTimeout.current);
    copiedTimeout.current = window.setTimeout(
      () => setCopied(false),
      COPIED_TIMEOUT_MS,
    );
  }, [command]);

  return (
    <span className="flex flex-col gap-1.5">
      <span className="font-mono text-xs">
        {current} {"\u2192"}{" "}
        <span className="text-foreground">{latest}</span>
      </span>

      <span className="flex items-center gap-1 rounded-sm border bg-muted/40 py-0.5 pr-0.5 pl-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground select-all">
          {command}
        </code>
        {canCopy && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopy}
            aria-label="Copy update command"
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </Button>
        )}
      </span>
    </span>
  );
}

/**
 * Raises a toast when a newer Pi SDK is available. Renders nothing itself.
 *
 * Informational only. The update runs in a terminal on the server machine: a
 * server cannot stop, reinstall and rebuild itself without killing the process
 * doing the work. See docs/adr/0002.
 *
 * Visibility rules:
 *   - the data is fetched client-side, so nothing about this runs during SSR
 *     and the dismissal cookie can never cause a hydration mismatch;
 *   - `timeout: 0` keeps it up until you close it, which is what makes
 *     "dismissed" a real signal rather than "you looked away";
 *   - closing stores the *version*, in a cookie that expires at local
 *     midnight, so it stays quiet for the rest of the day but a newer release
 *     still gets through;
 *   - the CLI's own `declined` flag is ignored on purpose. That one means
 *     "stop prompting me in this terminal", and this may be another device.
 */
export default function UpdateToast() {
  const fetcher = useFetcher<UpdateCheckResult>();
  const [dismissed, setDismissed] = useCookie<string | null>(DISMISS_COOKIE, {
    defaultValue: null,
  });

  const requested = useRef(false);
  const shownFor = useRef<string | null>(null);

  // one load per mount. The layout keeps this mounted across client-side
  // navigation, so that is also once per full page load.
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    fetcher.load("/updates");
  }, [fetcher]);

  const update = useMemo(
    () => (fetcher.data?.updateAvailable ? fetcher.data : null),
    [fetcher.data],
  );

  const shouldShow = useMemo(
    () => Boolean(update) && dismissed !== update?.latest,
    [update, dismissed],
  );

  // `setDismissed` is a new function every render, so it cannot be a
  // dependency below without re-raising the toast on each one
  const dismiss = useRef(setDismissed);
  useEffect(() => {
    dismiss.current = setDismissed;
  });

  useEffect(() => {
    if (!shouldShow || !update) return;

    // keyed on the version rather than a boolean: a newer release landing in
    // the same session should still get its own toast
    if (shownFor.current === update.latest) return;
    shownFor.current = update.latest;

    toast.add({
      id: TOAST_ID,
      type: "info",
      timeout: 0,
      title: "Pi SDK update available",
      description: (
        <UpdateToastBody
          current={update.current}
          latest={update.latest}
          command={update.command}
        />
      ),
      onClose: () => {
        dismiss.current(update.latest, {
          expires: startOfTomorrow(),
          path: "/",
        });
      },
    });
  }, [shouldShow, update]);

  return null;
}
