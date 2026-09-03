import type { SupportedAppLocale } from "./api";
import type { RichTextDocument } from "./blog";
import type { PublishablePost } from "./publication";

/**
 * Representative posts for previewing a blog layout.
 *
 * A template is a layout with holes in it: without a record behind it, an article preview is a
 * column of empty boxes and an index preview is a list of nothing. A designer previewing the layout
 * they just built saw the site's home page instead, which answered a question they had not asked.
 *
 * These records exist so a layout can be seen working before a single post is written. They are
 * never stored, never published, and never returned by any endpoint a visitor can reach — the one
 * caller is the authenticated template preview.
 *
 * The copy lives here rather than in the frontend's locale resources because it is rendered by the
 * backend renderer, which cannot reach them. Both supported languages are kept side by side for the
 * same reason the locale files are: so neither can be updated without the other being obvious.
 */

const paragraph = (text: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] });

type SampleCopy = {
  posts: ReadonlyArray<{ slug: string; title: string; excerpt: string; author: string; body: readonly string[] }>;
};

const COPY: Record<SupportedAppLocale, SampleCopy> = {
  "pt-BR": {
    posts: [
      {
        slug: "exemplo-post-principal",
        title: "Exemplo: este é o título do post",
        excerpt: "Este resumo aparece nos cartões da listagem e nos resultados de busca.",
        author: "Autoria de exemplo",
        body: [
          "Este é um post de exemplo, criado apenas para você ver o layout funcionando. Ele não existe no seu blog e não será publicado.",
          "Quando você escrever um post de verdade, o título, o resumo, a capa, a data e o texto virão do que você digitou — nos mesmos lugares em que aparecem aqui.",
        ],
      },
      {
        slug: "exemplo-segundo-post",
        title: "Exemplo: um segundo post na listagem",
        excerpt: "Cada post publicado vira um cartão como este, na ordem definida pela data.",
        author: "Autoria de exemplo",
        body: ["Conteúdo de exemplo para a listagem."],
      },
      {
        slug: "exemplo-terceiro-post",
        title: "Exemplo: e um terceiro",
        excerpt: "Assim dá para ver o espaçamento entre vários cartões antes de escrever.",
        author: "Autoria de exemplo",
        body: ["Conteúdo de exemplo para a listagem."],
      },
    ],
  },
  "en-US": {
    posts: [
      {
        slug: "sample-lead-post",
        title: "Sample: this is the post title",
        excerpt: "This excerpt appears on the index cards and in search results.",
        author: "Sample author",
        body: [
          "This is a sample post, here only so you can see the layout working. It is not in your blog and it will never be published.",
          "When you write a real post, its title, excerpt, cover, date and body come from what you typed — in the same places they appear here.",
        ],
      },
      {
        slug: "sample-second-post",
        title: "Sample: a second post on the index",
        excerpt: "Every published post becomes a card like this one, ordered by its date.",
        author: "Sample author",
        body: ["Sample content for the index."],
      },
      {
        slug: "sample-third-post",
        title: "Sample: and a third",
        excerpt: "Enough cards to judge the spacing between them before writing anything.",
        author: "Sample author",
        body: ["Sample content for the index."],
      },
    ],
  },
};

/** The article layout previews the first of these; the index previews all of them. */
export function sampleBlogPosts(
  locale: SupportedAppLocale,
  options: { coverMediaId?: string; now?: string } = {},
): PublishablePost[] {
  const now = options.now ?? new Date().toISOString();
  const day = 24 * 60 * 60 * 1000;

  return COPY[locale].posts.map((post, index) => {
    const published = new Date(Date.parse(now) - index * day).toISOString();
    const content: RichTextDocument = { type: "doc", content: post.body.map(paragraph) };

    return {
      id: `sample-${index + 1}`,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      status: "published",
      content,
      authorName: post.author,
      publishedAt: published,
      updatedAt: published,
      // Only a cover the workspace actually owns. A made-up id would render the broken image this
      // preview exists to help somebody avoid.
      ...(options.coverMediaId === undefined ? {} : { coverMediaId: options.coverMediaId }),
    };
  });
}
