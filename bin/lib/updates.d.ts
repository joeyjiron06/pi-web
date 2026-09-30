/**
 * Hand-written types for `bin/lib/updates.js`.
 *
 * `tsconfig.json` has `include: ["**\/*"]` but no `allowJs`, so importing that
 * module from a `.ts` file would fail `pnpm typecheck` without this. A
 * declaration file is preferred over turning `allowJs` on, which would pull
 * every script in `bin/` into type checking.
 */

/** One package that will be moved to `latest`. */
export interface PiPackageUpdate {
  name: string;
  /** Version currently in `node_modules`, or `null` if not installed. */
  current: string | null;
  latest: string;
}

export interface UpdateCheck {
  /** Local `YYYY-MM-DD` the registry was last consulted. */
  checkedOn: string;
  /** Lowest installed version across the Pi packages, or `null`. */
  current: string | null;
  /** Highest `latest` across the Pi packages. */
  latest: string;
  /** The prompt was answered "no" today. Terminal-only; the web alert ignores it. */
  declined: boolean;
  packages: PiPackageUpdate[];
  updateAvailable: boolean;
}

export interface UpdateCheckOptions {
  projectDir: string;
  /** Never touch the network, however stale the cache is. */
  cachedOnly?: boolean;
  /** Ignore the cache and re-check now. */
  force?: boolean;
}

export type UpdateStep = "backup" | "install" | "build" | "rollback";

export interface RunUpdateOptions {
  projectDir: string;
  packages: PiPackageUpdate[];
  /** Version every package is installed at. */
  to: string;
  onStep?: (step: UpdateStep) => void;
}

export type RunUpdateResult =
  | { ok: true; to: string }
  | { ok: false; error: string };

export function compareVersions(a: string, b: string): number;
export function todayKey(now?: Date): string;
export function getPiPackages(projectDir: string): string[];
export function getInstalledVersion(projectDir: string, name: string): string | null;

export function readState(projectDir: string): Record<string, unknown> | null;
export function writeState(projectDir: string, state: unknown): void;
export function clearState(projectDir: string): void;
export function markDeclined(projectDir: string): void;

/** Returns `null` when the answer is unknown. Never throws. */
export function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateCheck | null>;

/** Returns `null` when there is no TTY to prompt on. */
export function confirmPrompt(question: string): Promise<boolean | null>;

export function runUpdate(options: RunUpdateOptions): Promise<RunUpdateResult>;
