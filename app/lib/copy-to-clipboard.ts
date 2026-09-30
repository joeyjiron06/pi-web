/**
 * Copy text to the clipboard, with a fallback for insecure origins.
 *
 * `navigator.clipboard` only exists in a *secure context*. This server is
 * reached over plain HTTP on a LAN or Tailscale address, which is not one, so
 * on anything but `localhost` the modern API is simply `undefined` and a
 * button wired straight to it does nothing at all, silently.
 *
 * `document.execCommand("copy")` is deprecated but works everywhere, including
 * insecure origins, so it is the fallback rather than the other way round.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied or a non-secure context that still exposed the API;
      // fall through to the legacy path rather than giving up
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    // off-screen but still focusable; `display: none` would break selection
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";

    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Whether a copy button has any chance of working here.
 *
 * Returns `false` during SSR. Callers that render a button should guard on
 * this so an insecure origin gets no button rather than a dead one.
 */
export function canCopyToClipboard(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  return (
    Boolean(navigator?.clipboard?.writeText) ||
    typeof document.execCommand === "function"
  );
}
