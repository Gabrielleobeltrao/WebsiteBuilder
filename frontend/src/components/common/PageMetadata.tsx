import { useEffect } from "react";

/**
 * Sets the document title and description for a client-rendered route.
 *
 * This is enough for the SaaS shell, where crawlability is not a product requirement. It is
 * deliberately NOT the mechanism for customer sites: published routes get server-rendered HTML and
 * metadata from the publication snapshot, because a client-only title is not evidence that a
 * crawler ever sees it.
 */
export function PageMetadata({ title, description }: { title: string; description?: string }): null {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const createdMeta = meta === null;
    if (description !== undefined) {
      if (meta === null) {
        meta = document.createElement("meta");
        meta.name = "description";
        document.head.appendChild(meta);
      }
      meta.content = description;
    }

    return () => {
      document.title = previousTitle;
      if (createdMeta) meta?.remove();
    };
  }, [title, description]);

  return null;
}
