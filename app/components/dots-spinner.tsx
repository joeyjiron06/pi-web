import { cn } from "~/lib/utils";
import "./dots-spinner.css";

export default function DotsSpinner({
  className,
  ...props
}: React.ComponentProps<"svg">) {
  return (
    <svg
      className={cn("braille-spinner", className)}
      viewBox="0 0 20 32"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle className="dot-1" cx="6" cy="6" r="3" />
      <circle className="dot-2" cx="6" cy="16" r="3" />
      <circle className="dot-3" cx="6" cy="26" r="3" />
      <circle className="dot-4" cx="14" cy="6" r="3" />
      <circle className="dot-5" cx="14" cy="16" r="3" />
      <circle className="dot-6" cx="14" cy="26" r="3" />
    </svg>
  );
}
