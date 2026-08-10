import "i18next";

import type { resources } from "./resources";

/**
 * Types `t()` against the English catalogue, so an unknown key or namespace fails to compile.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["en-US"];
    returnNull: false;
  }
}
