import { useEffect, useMemo, useState } from "react";
import { useRouteLoaderData } from "react-router";
import Cookies, {
  type CookieChangeOptions,
  type CookieSetOptions,
} from "universal-cookie";
import type { loader } from "~/root";

type UseCookieOptions<T> = {
  defaultValue: T;
};

export function useCookies() {
  const cookieHeader = useRouteLoaderData<typeof loader>("root")?.cookie;
  const cookies = useMemo(
    () => new Cookies(cookieHeader, { path: "/" }),
    [cookieHeader],
  );

  return cookies;
}

export function useCookie<T>(name: string, options: UseCookieOptions<T>) {
  const cookies = useCookies();

  const defaultValue = options.defaultValue;

  const [cookieValue, setCookieValueInternal] = useState<T>(
    () => cookies.get<T>(name) ?? defaultValue,
  );

  function setCookieValue(
    value: T | ((prev: T) => T),
    options?: CookieSetOptions,
  ) {
    const newValue =
      typeof value === "function"
        ? (value as (prev: T) => T)(cookieValue)
        : value;
    cookies.set(name, newValue, options);
    setCookieValueInternal(newValue);
  }

  useEffect(() => {
    function handleCookieChange(options: CookieChangeOptions) {
      if (options.name === name) {
        setCookieValueInternal(options.value);
      }
    }

    cookies.addChangeListener(handleCookieChange);

    return () => {
      cookies.removeChangeListener(handleCookieChange);
    };
  }, [cookies, name]);

  return [cookieValue, setCookieValue] as const;
}
