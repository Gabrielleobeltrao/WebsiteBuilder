import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { RoadmapStatusBadge } from "@/features/public/RoadmapStatusBadge";
import { roadmapPreviewItems } from "@/features/public/roadmap-data";

const BENEFIT_KEYS = ["responsive", "multitenant", "publishing", "content"] as const;
const FEATURE_KEYS = ["editor", "media", "seo", "forms", "cms", "domains"] as const;
const STEP_KEYS = ["one", "two", "three"] as const;
const FAQ_KEYS = ["code", "mobile", "domain", "export"] as const;

function Section({
  children,
  className = "",
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={`px-6 py-16 sm:px-10 lg:px-16 lg:py-24 ${className}`}>
      <div className="mx-auto max-w-5xl">{children}</div>
    </section>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
      {children}
    </h2>
  );
}

/** A static illustration of the two section modes. Decorative: the copy beside it carries meaning. */
function CanvasIllustration() {
  const { t } = useTranslation("public");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <figure className="rounded-xl border border-ink-200 bg-ink-50 p-4">
        <figcaption className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-500">
          {t("landing.demo.freeLabel")}
        </figcaption>
        <div aria-hidden className="relative h-40 rounded-lg bg-white ring-1 ring-ink-200">
          <div className="absolute left-4 top-4 h-6 w-28 rounded bg-ink-800" />
          <div className="absolute left-4 top-14 h-3 w-40 rounded bg-ink-200" />
          <div className="absolute left-4 top-20 h-3 w-32 rounded bg-ink-200" />
          <div className="absolute bottom-4 left-4 h-8 w-24 rounded-md bg-accent-500" />
          <div className="absolute right-4 top-6 h-24 w-24 rounded-lg bg-accent-100 ring-2 ring-accent-400" />
          <div className="absolute right-2 top-4 size-2 rounded-full bg-accent-600" />
          <div className="absolute right-2 top-[7.25rem] size-2 rounded-full bg-accent-600" />
          <div className="absolute right-[6.5rem] top-4 size-2 rounded-full bg-accent-600" />
          <div className="absolute right-[6.5rem] top-[7.25rem] size-2 rounded-full bg-accent-600" />
        </div>
      </figure>
      <figure className="rounded-xl border border-ink-200 bg-ink-50 p-4">
        <figcaption className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-500">
          {t("landing.demo.structuredLabel")}
        </figcaption>
        <div aria-hidden className="grid h-40 grid-cols-3 gap-2 rounded-lg bg-white p-3 ring-1 ring-ink-200">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="rounded bg-ink-100" />
          ))}
        </div>
      </figure>
    </div>
  );
}

export function LandingPage() {
  const { t } = useTranslation("public");
  const previewItems = roadmapPreviewItems();

  return (
    <>
      <PageMetadata title={t("landing.metaTitle")} description={t("landing.metaDescription")} />

      <Section labelledBy="hero-title" className="border-b border-ink-100">
        <p className="text-sm font-medium uppercase tracking-widest text-accent-700">{t("landing.hero.eyebrow")}</p>
        <h1
          id="hero-title"
          className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight text-ink-950
            sm:text-5xl lg:text-6xl"
        >
          {t("landing.hero.title")}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-600">{t("landing.hero.subtitle")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/signup"
            className="rounded-md bg-accent-600 px-5 py-3 text-sm font-semibold text-white hover:bg-accent-700"
          >
            {t("landing.hero.primaryCta")}
          </Link>
          <Link
            to="/roadmap"
            className="rounded-md border border-ink-200 px-5 py-3 text-sm font-semibold text-ink-700
              hover:border-ink-300 hover:bg-ink-50"
          >
            {t("landing.hero.secondaryCta")}
          </Link>
        </div>
      </Section>

      <Section labelledBy="demo-title">
        <SectionTitle id="demo-title">{t("landing.demo.title")}</SectionTitle>
        <p className="mt-4 max-w-2xl text-ink-600">{t("landing.demo.description")}</p>
        <div className="mt-8">
          <CanvasIllustration />
        </div>
      </Section>

      <Section labelledBy="benefits-title" className="bg-ink-50">
        <SectionTitle id="benefits-title">{t("landing.benefits.title")}</SectionTitle>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2">
          {BENEFIT_KEYS.map((key) => (
            <li key={key} className="rounded-xl border border-ink-200 bg-white p-6">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {t(`landing.benefits.items.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {t(`landing.benefits.items.${key}.description`)}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="features-title">
        <SectionTitle id="features-title">{t("landing.features.title")}</SectionTitle>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_KEYS.map((key) => (
            <li key={key} className="rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm text-ink-700">
              {t(`landing.features.items.${key}`)}
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="usecases-title" className="bg-ink-50">
        <SectionTitle id="usecases-title">{t("landing.useCases.title")}</SectionTitle>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {(["agency", "selfService"] as const).map((key) => (
            <article key={key} className="rounded-xl border border-ink-200 bg-white p-6">
              <h3 className="font-display text-lg font-semibold text-ink-900">{t(`landing.useCases.${key}.title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{t(`landing.useCases.${key}.description`)}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section labelledBy="workflow-title">
        <SectionTitle id="workflow-title">{t("landing.workflow.title")}</SectionTitle>
        <ol className="mt-8 grid gap-6 sm:grid-cols-3">
          {STEP_KEYS.map((key, index) => (
            <li key={key} className="border-t-2 border-accent-500 pt-4">
              <span className="font-display text-sm font-semibold text-accent-700">{index + 1}</span>
              <h3 className="mt-1 font-display text-lg font-semibold text-ink-900">
                {t(`landing.workflow.steps.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {t(`landing.workflow.steps.${key}.description`)}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section labelledBy="roadmap-preview-title" className="bg-ink-50">
        <SectionTitle id="roadmap-preview-title">{t("landing.roadmapPreview.title")}</SectionTitle>
        <p className="mt-4 max-w-2xl text-ink-600">{t("landing.roadmapPreview.description")}</p>
        <ul className="mt-8 space-y-3">
          {previewItems.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200
                bg-white px-4 py-3"
            >
              <span className="text-sm font-medium text-ink-800">{t(`roadmap.items.${item.id}.title`)}</span>
              <RoadmapStatusBadge status={item.status} />
            </li>
          ))}
        </ul>
        <Link
          to="/roadmap"
          className="mt-6 inline-block text-sm font-semibold text-accent-700 underline underline-offset-4"
        >
          {t("landing.roadmapPreview.cta")}
        </Link>
      </Section>

      <Section labelledBy="faq-title">
        <SectionTitle id="faq-title">{t("landing.faq.title")}</SectionTitle>
        <div className="mt-8 divide-y divide-ink-100 border-y border-ink-100">
          {FAQ_KEYS.map((key) => (
            <details key={key} className="group py-4">
              <summary className="cursor-pointer list-none font-medium text-ink-900 marker:content-none">
                {t(`landing.faq.items.${key}.question`)}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">{t(`landing.faq.items.${key}.answer`)}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section labelledBy="final-cta-title" className="bg-ink-900 text-white">
        <SectionTitle id="final-cta-title">
          <span className="text-white">{t("landing.finalCta.title")}</span>
        </SectionTitle>
        <p className="mt-4 max-w-xl text-ink-200">{t("landing.finalCta.description")}</p>
        <Link
          to="/signup"
          className="mt-8 inline-block rounded-md bg-accent-500 px-5 py-3 text-sm font-semibold text-ink-950
            hover:bg-accent-400"
        >
          {t("landing.finalCta.action")}
        </Link>
      </Section>

      <footer className="border-t border-ink-100 px-6 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-sm text-sm text-ink-500">{t("landing.footer.tagline")}</p>
          <nav aria-label={t("landing.footer.legal")} className="text-sm">
            <ul className="space-y-2">
              <li>
                <Link to="/terms" className="text-ink-600 underline underline-offset-4 hover:text-ink-900">
                  {t("landing.footer.terms")}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-ink-600 underline underline-offset-4 hover:text-ink-900">
                  {t("landing.footer.privacy")}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </>
  );
}
