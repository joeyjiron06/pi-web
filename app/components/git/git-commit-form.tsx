import { ChevronDownIcon, GitCommitVerticalIcon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Textarea } from "~/components/ui/textarea";
import { Spinner } from "~/components/ui/spinner";
import { toast } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import type { GitCommitResult } from "~/routes/git/commit";

/**
 * Commit message box and commit button at the top of the git panel.
 *
 * The textarea auto-grows with its content. `field-sizing-content` (already on
 * the shared Textarea) does this natively, but only in Chromium, so the height
 * is also driven manually -- an explicit height wins over `field-sizing`, so
 * the two don't fight.
 *
 * Nothing here refreshes the status list: `GitChangesPanel`'s `/git/status`
 * fetcher is revalidated automatically once this action completes.
 */
export default function GitCommitForm({
  hasStagedChanges,
  repoRoot,
}: {
  hasStagedChanges: boolean;
  repoRoot: string;
}) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fetcher = useFetcher<GitCommitResult>();
  const formId = useId();

  const action = useMemo(
    () => `/git/commit?directory=${encodeURIComponent(repoRoot)}`,
    [repoRoot],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMessage(event.target.value);
    },
    [],
  );

  // the menu lives in a portal, so a submit button inside it is outside the
  // form in the DOM and its activation is racing the menu's own unmount.
  // submitting the values directly sidesteps both problems, and still posts
  // the same `message`/`intent` fields the plain Commit button does.
  const { submit } = fetcher;
  const handleCommitAndPush = useCallback(() => {
    submit(
      { message, intent: "commit-and-push" },
      { method: "post", action },
    );
  }, [submit, message, action]);

  const handleCommit = useCallback(() => {
    submit({ message }, { method: "post", action });
  }, [submit, message, action]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (!result.ok) {
      toast.add({
        title: "Commit failed",
        description: result.error,
        type: "error",
      });
      return;
    }
    // only cleared once the commit actually landed, so a rejected hook doesn't
    // cost the user their message
    setMessage("");
  }, [fetcher.data]);

  const isSubmitting = fetcher.state !== "idle";
  const isCommitDisabled =
    !hasStagedChanges || message.trim() === "" || isSubmitting;

  const disabledReason = useMemo(() => {
    if (isSubmitting) return "Committing…";
    if (!hasStagedChanges) return "Stage changes before committing";
    return undefined;
  }, [isSubmitting, hasStagedChanges]);

  return (
    <fetcher.Form
      id={formId}
      method="post"
      action={action}
      className="flex flex-col gap-2 p-2"
    >
      <Textarea
        ref={textareaRef}
        name="message"
        value={message}
        onChange={handleChange}
        placeholder="Commit message"
        rows={1}
        // min-h-0 overrides the shared min-h-16 so a single line stays compact
        // and the measured height is what's actually applied
        className="min-h-0 max-h-40 resize-none"
      />
      <ButtonGroup className="w-full">
        {/* no `intent` field: its absence is what the action reads as a plain
            commit */}
        <Button
          type="submit"
          disabled={isCommitDisabled}
          title={disabledReason}
          className="relative flex-1"
        >
          {/* the label is faded rather than removed, and the spinner is
              absolutely positioned over it, so the button keeps the width its
              text gives it -- swapping the two would shrink the button (and
              the whole ButtonGroup) the moment a commit starts */}
          <span className={cn(isSubmitting && "opacity-0")}>Commit</span>
          {isSubmitting && (
            <span className="absolute inset-0 flex items-center justify-center">
              {/* the button's own `title` already announces "Committing…", so
                  the Spinner's default role/label would be a second, competing
                  accessible name for the same control */}
              <Spinner
                className="size-4"
                role={undefined}
                aria-label={undefined}
                aria-hidden
              />
            </span>
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                disabled={isCommitDisabled}
                title={disabledReason}
                aria-label="More commit options"
                className="pl-2!"
              >
                <ChevronDownIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={handleCommit}>
                <GitCommitVerticalIcon />
                Commit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCommitAndPush}>
                <UploadIcon />
                Commit &amp; Push
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </fetcher.Form>
  );
}
