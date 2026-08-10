import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "react-router";

import { AppRoutes } from "@/app/routes";
import { bootstrapI18n } from "@/i18n";
import "@/styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

const i18n = bootstrapI18n();

// Phase 7 replaces this with the real Better Auth session. Until it exists, the authenticated area
// opens only when a developer explicitly names the seeded workspace the backend also uses, so the
// app never pretends someone is signed in by default.
const authenticated = Boolean(import.meta.env.VITE_DEV_WORKSPACE);

createRoot(container).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <AppRoutes authenticated={authenticated} />
      </BrowserRouter>
    </I18nextProvider>
  </StrictMode>,
);
