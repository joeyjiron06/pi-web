import { GitBranchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

type Props = {
  branches: readonly string[];
  /** currently checked out branch */
  branch: string;
  /**
   * when set, the selected branch is submitted with the surrounding <form>
   * under this name. opt-in because this picker is also used inside the
   * "create branch" dialog, which is not part of a form.
   */
  name?: string;
  /** rendered at the bottom of the popover, e.g. a "create branch" action */
  footer?: React.ReactNode;
  /** extra `CommandGroup`s/`CommandItem`s appended to the list, e.g. a "create branch" action */
  children?: React.ReactNode;
  onBranchChanged: (branch: string) => void;
  /** pinned to the top of the list and labelled as the default branch */
  mainBranch?: string;
  /** optionally control the popover, e.g. to close it from a custom child item */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function BranchPicker({
  branches,
  branch,
  name,
  footer,
  children,
  onBranchChanged,
  mainBranch,
  open: openProp,
  onOpenChange,
}: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;

  function setOpen(next: boolean) {
    setOpenState(next);
    onOpenChange?.(next);
  }

  // main first, everything else alphabetical, dupes dropped so cmdk keys stay unique
  const sorted = useMemo(() => {
    const unique = [...new Set(branches)];
    return unique.sort((a, b) => {
      if (a === mainBranch) return -1;
      if (b === mainBranch) return 1;
      return a.localeCompare(b);
    });
  }, [branches, mainBranch]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className="max-w-72" />}
        aria-label="Branch"
      >
        <GitBranchIcon />
        <span className="truncate">{branch || "Select branch"}</span>
        {/* deliberately outside <PopoverContent>: that subtree unmounts when the
          popover is closed, so a field in there would never be submitted */}
        {name && <input type="hidden" name={name} value={branch} />}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search branches" />
          <CommandList>
            <CommandEmpty>No branches found</CommandEmpty>
            <CommandGroup heading="Branches">
              {sorted.map((item) => (
                <CommandItem
                  key={item}
                  value={item}
                  // cmdk lowercases the value it hands back, so use the closure
                  onSelect={() => {
                    setOpen(false);
                    if (item !== branch) onBranchChanged(item);
                  }}
                  data-checked={item === branch}
                >
                  <GitBranchIcon className="text-muted-foreground" />
                  <span className="truncate" title={item}>
                    {item}
                  </span>
                  {item === mainBranch && (
                    <span className="shrink-0 text-muted-foreground">
                      default
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {children}
          </CommandList>

          {footer && <div className="border-t p-1">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
