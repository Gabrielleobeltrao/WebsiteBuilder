import type { SupportedAppLocale } from "@websitebuilder/shared";

import { apiRequest } from "./client";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  kind: "personal" | "agency" | "business";
  role: string;
  permissions: string[];
};

export const preferencesApi = {
  load(options: { signal?: AbortSignal } = {}) {
    return apiRequest<{ locale: SupportedAppLocale }>("/me/preferences", {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  save(locale: SupportedAppLocale) {
    return apiRequest<{ locale: SupportedAppLocale }>("/me/preferences", { method: "PUT", body: { locale } });
  },
};

export const workspacesApi = {
  list(options: { signal?: AbortSignal } = {}) {
    return apiRequest<WorkspaceSummary[]>("/workspaces", {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },
};
