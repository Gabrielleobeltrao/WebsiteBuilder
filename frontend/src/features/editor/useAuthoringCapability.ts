import { useEffect, useState } from "react";

/**
 * Desktop-class authoring gate.
 *
 * This is a product capability check, not a security boundary: every mutation endpoint still
 * requires authentication, authorisation and schema validation regardless of what the client
 * decides here. It combines viewport width with pointer precision rather than sniffing the user
 * agent, because a large tablet is still touch-first and a narrow desktop window is still a
 * desktop the moment it is widened again.
 */
export const MIN_AUTHORING_WIDTH = 1024;

export type AuthoringCapability = { canAuthor: true } | { canAuthor: false; reason: "touch" | "narrow" };

function measure(minWidth: number): AuthoringCapability {
  const width = globalThis.innerWidth ?? 0;
  const finePointer = globalThis.matchMedia?.("(pointer: fine)").matches ?? true;

  if (!finePointer) return { canAuthor: false, reason: "touch" };
  if (width < minWidth) return { canAuthor: false, reason: "narrow" };
  return { canAuthor: true };
}

export function useAuthoringCapability(minWidth = MIN_AUTHORING_WIDTH): AuthoringCapability {
  const [capability, setCapability] = useState<AuthoringCapability>(() => measure(minWidth));

  useEffect(() => {
    const update = () => setCapability(measure(minWidth));
    update();

    globalThis.addEventListener("resize", update);
    const pointerQuery = globalThis.matchMedia?.("(pointer: fine)");
    pointerQuery?.addEventListener?.("change", update);

    return () => {
      globalThis.removeEventListener("resize", update);
      pointerQuery?.removeEventListener?.("change", update);
    };
  }, [minWidth]);

  return capability;
}
