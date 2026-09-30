import { data } from "react-router";
import { getModels } from "~/services/models.server";

/**
 * Fetch the list of available models for the agent from the working directory you pass in.
 * Each model is paired with the thinking levels it supports.
 * Thinking levels are determined by the model's provider and its configuration.
 */
export async function loader() {
  return data({ models: await getModels() });
}
