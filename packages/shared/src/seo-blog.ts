import type { BlogPost } from "./blog";
import { createDefaultPageSeo, type SiteSeoSettings } from "./seo";
import { resolveMetadata, type ResolvedMetadata } from "./seo-resolve";

/**
 * Post metadata resolved from the post itself.
 *
 * Two posts rendered by one article template must produce distinct titles, descriptions,
 * canonicals and social cards. That only holds if metadata is derived from the post rather than
 * from the template, which is what this function guarantees.
 */
export type PostMetadataInput = {
  site: SiteSeoSettings;
  post: Pick<
    BlogPost,
    "title" | "excerpt" | "coverMediaId" | "authorName" | "publishedAt" | "status" | "seoTitle" | "seoDescription"
  >;
  path: string;
};

export function resolvePostMetadata(input: PostMetadataInput): ResolvedMetadata {
  const resolved = resolveMetadata({
    site: input.site,
    page: {
      ...createDefaultPageSeo(),
      title: input.post.seoTitle ?? input.post.title,
      description: input.post.seoDescription ?? input.post.excerpt,
      // A draft must never be indexable, whatever the site default says. Publication is what makes
      // a post public, so anything else is a leak waiting for a crawler to find it.
      robots: { index: input.post.status === "published", follow: true },
      openGraph: {
        type: "article",
        ...(input.post.coverMediaId ? { mediaId: input.post.coverMediaId } : {}),
      },
      structuredDataType: "Article",
    },
    fallbackTitle: input.post.title,
    path: input.path,
  });

  return resolved;
}

export type ArticleStructuredData = {
  "@context": "https://schema.org";
  "@type": "Article";
  headline: string;
  description?: string;
  datePublished?: string;
  author?: { "@type": "Person"; name: string };
  image?: string;
  mainEntityOfPage?: string;
  publisher?: { "@type": "Organization"; name: string };
};

/**
 * Builds Article JSON-LD. A draft produces nothing at all: emitting structured data for content
 * that is not public would advertise it to exactly the crawlers it is hidden from.
 */
export function buildArticleStructuredData(input: {
  metadata: ResolvedMetadata;
  post: Pick<BlogPost, "title" | "authorName" | "publishedAt" | "status">;
  site: Pick<SiteSeoSettings, "siteName" | "organization">;
  imageUrl?: string | null;
}): ArticleStructuredData | null {
  if (input.post.status !== "published") return null;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.metadata.title,
    ...(input.metadata.description ? { description: input.metadata.description } : {}),
    ...(input.post.publishedAt ? { datePublished: input.post.publishedAt } : {}),
    ...(input.post.authorName ? { author: { "@type": "Person" as const, name: input.post.authorName } } : {}),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    ...(input.metadata.canonicalUrl ? { mainEntityOfPage: input.metadata.canonicalUrl } : {}),
    publisher: { "@type": "Organization", name: input.site.organization?.name ?? input.site.siteName },
  };
}

/**
 * Serialises JSON-LD for embedding in a script tag.
 *
 * `<` is escaped so a value can never close the surrounding script element. JSON.stringify alone
 * does not do this, and it is the one escape that turns structured data into an injection vector.
 */
export function serializeStructuredData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
