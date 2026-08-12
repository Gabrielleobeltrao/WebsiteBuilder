import type { FormSummary } from "@websitebuilder/shared";
import { createContext, useContext } from "react";

/**
 * The project's forms, reachable from the inspector without threading them through the panel.
 *
 * The inspector sits four components below the shell that loads them, and every one of those
 * components would otherwise carry props it has no use for. A context is the smaller change and
 * keeps the panel's own signature about panels.
 */
export type BuilderFormsValue = {
  workspaceId: string;
  projectId: string;
  forms: readonly FormSummary[];
  loading: boolean;
  reload: () => void;
};

const fallback: BuilderFormsValue = {
  workspaceId: "",
  projectId: "",
  forms: [],
  loading: false,
  reload: () => undefined,
};

export const BuilderFormsContext = createContext<BuilderFormsValue>(fallback);

export function useBuilderForms(): BuilderFormsValue {
  return useContext(BuilderFormsContext);
}
