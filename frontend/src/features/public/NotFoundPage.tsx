import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";

export function NotFoundPage() {
  const { t } = useTranslation(["public", "common"]);
  return (
    <div className="px-6 py-20 sm:px-10 lg:px-16">
      <PageMetadata title={`${t("public:notFound.title")} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{t("public:notFound.title")}</h1>
        <p className="mt-3 text-ink-600">{t("public:notFound.description")}</p>
        <Link
          to="/"
          className="mt-8 inline-block rounded-md bg-accent-600 px-5 py-3 text-sm font-semibold text-white
            hover:bg-accent-700"
        >
          {t("public:notFound.action")}
        </Link>
      </div>
    </div>
  );
}
