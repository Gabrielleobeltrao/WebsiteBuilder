import { featureElementTypes, SITE_FEATURE_KEYS } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import routes from "@/app/routes.tsx?raw";
import { MODULE_ROUTES } from "@/features/sites/SiteDashboard";

/**
 * Every destination the site dashboard can offer has to exist.
 *
 * The Forms entry pointed at `/forms` for a whole release while no such route was declared, so the
 * one link the module's own navigation produced landed on "page not found". A list of module routes
 * and a list of declared routes are two lists somebody has to keep in agreement by hand, and this is
 * what does the keeping.
 *
 * Read from the route table's source rather than by rendering it: mounting the authenticated shell
 * pulls in every lazy chunk and its data loading, which is a slow and flaky way to answer a question
 * that is really about one file.
 */
const declared = (feature: (typeof SITE_FEATURE_KEYS)[number]) =>
  routes.includes(`path="sites/:projectId/${MODULE_ROUTES[feature]}"`);

describe("the site dashboard's module destinations", () => {
  for (const feature of SITE_FEATURE_KEYS) {
    it(`${feature} either has a route or cannot appear in navigation`, () => {
      // A module with no block that activates it can never leave "unused", so its entry is never
      // rendered and its missing route is unreachable rather than broken. The day a block declares
      // that feature, this fails and asks for the route — which is the point.
      const reachable = featureElementTypes(feature).length > 0;
      expect(declared(feature) || !reachable, `${feature} -> ${MODULE_ROUTES[feature]}`).toBe(true);
    });
  }

  it("declares a route for every module a block can activate", () => {
    const activatable = SITE_FEATURE_KEYS.filter((feature) => featureElementTypes(feature).length > 0);
    expect(activatable.filter((feature) => !declared(feature))).toEqual([]);
  });
});
