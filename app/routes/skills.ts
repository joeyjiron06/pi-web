import { data } from "react-router";
import { getSkills, type SkillSummary } from "~/services/skills.server";
import type { Route } from "./+types/skills";

export type SkillsResult = {
  skills: SkillSummary[];
};

/**
 * Fetch the list of available skills for the agent from the working directory you pass in.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const directory = url.searchParams.get("directory");

  if (!directory?.trim()) {
    return data<SkillsResult>({ skills: [] });
  }

  return data<SkillsResult>({ skills: await getSkills(directory) });
}
