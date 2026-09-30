/**
 * The web side of the daily Pi SDK update check.
 *
 * This is a thin wrapper around `bin/lib/updates.js`, which is the single
 * implementation shared with the CLI. Two reasons the web server runs the
 * check itself rather than only reading the cache file:
 *
 *   - The file is only written when something checks. A server left running
 *     for weeks would otherwise report a weeks-old answer, which is exactly
 *     the case this feature exists for.
 *   - It cannot clobber the CLI's `declined` flag. Whichever of the two runs
 *     second sees `checkedOn === today`, returns the cache and writes nothing.
 *
 * The alert is informational only. Updating happens in a terminal, because a
 * server cannot stop, reinstall and rebuild itself without either killing the
 * updater or growing a supervisor process. See docs/adr/0002.
 */

import { fileURLToPath } from "node:url";
import { checkForUpdate } from "../../bin/lib/updates.js";

/**
 * `../../` lands on the project root in both dev (`app/services/`) and the
 * build (`build/server/`). Both happen to be two levels deep, which is what
 * `app/services/projects.server.ts` relies on too. Moving this file breaks it.
 *
 * It is resolved here rather than inside the shared module on purpose: vite
 * bundles that module into `build/server/index.js`, so any path it derived
 * from its own `import.meta.url` would point at the build output.
 */
const PROJECT_DIR = fileURLToPath(new URL("../../", import.meta.url));

/** The command the alert tells you to run. Requires `pnpm link --global` once. */
const UPDATE_COMMAND = "pi-web update";

export type UpdateCheckResponse =
  | { updateAvailable: false }
  | {
      updateAvailable: true;
      current: string;
      latest: string;
      command: string;
    };

/**
 * Is a newer Pi SDK available?
 *
 * Hits the registry at most once per calendar day; every other call reads a
 * file. Never throws and never reports a problem to the client: an expired
 * npm token or a dropped network must not put an error banner on the page.
 *
 * Deliberately ignores the CLI's `declined` flag. That flag means "stop
 * prompting me in this terminal today"; the browser has its own dismissal
 * cookie, possibly on a different device.
 */
export async function checkForUpdateFromWeb(
  force = false,
): Promise<UpdateCheckResponse> {
  try {
    const check = await checkForUpdate({ projectDir: PROJECT_DIR, force });

    if (!check?.updateAvailable || !check.current) {
      return { updateAvailable: false };
    }

    return {
      updateAvailable: true,
      current: check.current,
      latest: check.latest,
      command: UPDATE_COMMAND,
    };
  } catch (error) {
    console.error("[updates] check failed", error);
    return { updateAvailable: false };
  }
}
