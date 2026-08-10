import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "react-router";

import { App } from "@/app/App";
import { bootstrapI18n } from "@/i18n";
import "@/styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

const i18n = bootstrapI18n();

createRoot(container).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nextProvider>
  </StrictMode>,
);
