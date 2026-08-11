import { useEffect, useState, type DependencyList } from "react";

import { ApiError } from "@/api/client";

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "ready"; data: T };

/**
 * Loads one analytics resource and cancels the previous request when the filters change.
 *
 * The cancellation is the point: without it a slow answer for last month can land after a fast one
 * for last week and leave the screen showing numbers that do not match the filter above them.
 */
export function useAnalyticsResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    load(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      });

    return () => controller.abort();
    // The loader closes over the filters; the dependency list is what the caller varies by.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
