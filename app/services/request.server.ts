import { data } from "react-router";

/**
 * Request parsing for the resource routes.
 *
 * Deliberately knows nothing about git, or about any other domain: every
 * function here reads a `Request`/`FormData` and either returns a plain value
 * or throws. Business logic runs on the values, in the route.
 *
 * The `get*` functions return `null` for a missing value; the `require*`
 * functions throw a {@link RequestError}. Loaders that degrade to an empty
 * state use the former, actions that must report a failure use the latter.
 */

/**
 * An error whose message is meant for the client, under a chosen status.
 *
 * Anything else that escapes a route is a bug, and {@link toErrorResponse}
 * treats it as one.
 */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

/** A query param, or `null` when absent or blank. */
export function getSearchParam(request: Request, name: string): string | null {
  const value = new URL(request.url).searchParams.get(name);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A query param, or a 400 naming the one that's missing. */
export function requireSearchParam(request: Request, name: string): string {
  const value = getSearchParam(request, name);
  if (!value) {
    throw new RequestError(400, `A ${name} is required`);
  }
  return value;
}

/** A single form field, trimmed, or a 400 naming the one that's missing. */
export function requireString(
  formData: FormData,
  name: string,
  missingMessage = `A ${name} is required`,
): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) {
    throw new RequestError(400, missingMessage);
  }
  return value;
}

/**
 * Every value of a repeated form field, trimmed, blanks dropped, duplicates
 * removed.
 *
 * Throws on an empty result rather than returning `[]`: the callers pass these
 * straight to git as a pathspec, and several git commands operate on the
 * *entire repo* when handed none.
 */
export function requireStrings(
  formData: FormData,
  name: string,
  emptyMessage = `At least one ${name} entry is required`,
): string[] {
  const values = new Set(
    formData
      .getAll(name)
      .map((value) => String(value).trim())
      .filter(Boolean),
  );

  if (values.size === 0) {
    throw new RequestError(400, emptyMessage);
  }

  return [...values];
}

/** The message of an `Error`, or `fallback` for anything else that was thrown. */
export function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Turns a thrown error into the JSON body the routes return on failure.
 *
 * Returns rather than re-throws: these routes are posted to by `fetcher.Form`,
 * and letting the error reach an ErrorBoundary would put an HTML page into
 * `fetcher.data`.
 *
 * Only a {@link RequestError} is shown to the client. Anything else is an
 * unexpected throw -- a bug -- so its stack is kept on the server and the
 * client gets a generic message instead of a leaked internal detail.
 */
export function toErrorResponse(error: unknown): ReturnType<typeof data> {
  if (error instanceof RequestError) {
    return data({ ok: false, error: error.message }, { status: error.status });
  }

  console.error("Unhandled route error", error);
  return data({ ok: false, error: "Something went wrong" }, { status: 500 });
}
