import { useEffect, useState } from "react";

export function useAwait<T>(
  promise?: Promise<T>,
  callbacks?: {
    onFulfilled?: (value: T) => void;
    onRejected?: (error: Error) => void;
  },
) {
  const [result, setResult] = useState<T | null>(null);
  const [status, setStatus] = useState<"pending" | "fulfilled" | "rejected">(
    "pending",
  );
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    setStatus("pending");
    setResult(null);
    setError(null);

    promise
      ?.then((value) => {
        if (isMounted) {
          setStatus("fulfilled");
          setResult(value);
          callbacks?.onFulfilled?.(value);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setStatus("rejected");
          setError(error);
          callbacks?.onRejected?.(error);
        }
      });

    return () => {
      isMounted = false;
    };
    // callbacks are intentionally not deps: they'd re-run the effect (and the
    // side effects) on every render if a caller passed inline functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promise]);

  return [result, { status, error }] as const;
}
