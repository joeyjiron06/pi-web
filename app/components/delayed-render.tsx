import { useEffect, useState } from "react";

/**
 * The default "don't bother" threshold: anything that resolves faster than
 * this isn't worth showing a placeholder for, because the placeholder itself
 * becomes the flicker.
 */
export const FAST_DELAY = 200;

type Props = {
  children: React.ReactNode;
  delay: number;
};

/**
 * Delays rendering its children until `delay` ms have passed.
 *
 * Use it when the content it wraps may not be needed at all -- a loading
 * skeleton for data that usually arrives in a few milliseconds would otherwise
 * flash on screen and immediately be replaced, which reads as a glitch.
 *
 * The timer restarts whenever `delay` changes, and is cleared on unmount so a
 * fast-resolving load can't set state on a component that's already gone.
 */
export default function DelayedRender({ children, delay }: Props) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // a non-positive delay means "render immediately", and a `setTimeout(0)`
    // would still cost a frame
    if (delay <= 0) {
      setIsVisible(true);
      return;
    }

    setIsVisible(false);

    const timeoutId = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timeoutId);
  }, [delay]);

  if (!isVisible) return null;

  return children;
}
