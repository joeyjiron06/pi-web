import {
  DefaultResourceLoader,
  getAgentDir,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import cache from "~/services/cache.server";

export type SkillSummary = Pick<Skill, "name" | "description">;

/**
 * Skills come from files on disk, so a cached list goes stale as soon as the
 * user adds or edits one. 30 minutes keeps repeated folder switches cheap
 * without pinning a stale list for the whole life of the server.
 */
const SKILLS_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * The skills available to an agent running in `directory`.
 *
 * Lives in a service (rather than only in the `/skills` resource route) so
 * server-side callers -- the session loader -- can read it directly instead of
 * making the server fetch its own route.
 */
export async function getSkills(directory: string): Promise<SkillSummary[]> {
  if (!directory.trim()) {
    return [];
  }

  return cache.wrap(
    `skills:${directory}`,
    async () => {
      const loader = new DefaultResourceLoader({
        cwd: directory,
        agentDir: getAgentDir(),
      });
      await loader.reload();
      const loaderSkills = loader.getSkills();
      return loaderSkills.skills.map((s) => ({
        name: s.name,
        description: s.description,
      }));
    },
    { ttl: SKILLS_CACHE_TTL_MS },
  );
}
