import { data } from "react-router";
import {
  checkForUpdateFromWeb,
  type UpdateCheckResponse,
} from "~/services/updates.server";
import type { Route } from "./+types/updates";

/**
 * The shape `UpdateAlert` renders.
 *
 * Re-exported from the route rather than imported from the service by the
 * component: `updates.server.ts` is a server-only module, and even a type-only
 * import of it from a client component is a trap waiting for someone to drop
 * the `type` keyword. Same reasoning as `SkillsResult` in `routes/skills.ts`.
 */
export type UpdateCheckResult = UpdateCheckResponse;

/**
 * GET /updates  (`?force=1` to bypass the once-a-day cache)
 *
 * Fetched client-side by `UpdateAlert`, not from a loader, for two reasons: a
 * slow registry lookup can never delay a page render, and the alert always
 * renders `null` during SSR, so the dismissal cookie cannot cause a hydration
 * mismatch across timezones.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  return data<UpdateCheckResult>(await checkForUpdateFromWeb(force));
}
