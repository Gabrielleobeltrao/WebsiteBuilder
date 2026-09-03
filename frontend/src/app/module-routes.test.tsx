import { featureElementTypes, SITE_FEATURE_KEYS } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import routes from "@/app/routes.tsx?raw";
import { FIXED_DESTINATIONS, MODULE_ROUTES } from "@/features/sites/SiteDashboard";

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
const declared = (feature: (typeof SITE_FEATURE_KEYS)[number]) => {
  const path = MODULE_ROUTES[feature];
  // A module with no destination declares none, and nothing renders a link to it.
  return path !== null && routes.includes(`path="sites/:projectId/${path}"`);
};

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

describe("a module nobody has used yet", () => {
  it("is either reachable or has no destination at all", () => {
    // The blog was neither: its only switch lived inside a page nothing linked to, so turning it on
    // required knowing the URL. A module with a route is offered from the site dashboard; one
    // without a route is offered nowhere, which is the only other honest state.
    for (const feature of SITE_FEATURE_KEYS) {
      const path = MODULE_ROUTES[feature];
      expect(path === null || declared(feature), feature).toBe(true);
    }
  });
});

/**
 * The destinations every site has, not only the optional modules.
 *
 * The dashboard shows them in the same grid and they fail the same way: a card leading to a route
 * this build does not declare lands on "page not found", and the card looks exactly as trustworthy
 * as the ones that work.
 */
describe("the site dashboard's fixed destinations", () => {
  for (const [name, path] of Object.entries(FIXED_DESTINATIONS)) {
    it(`${name} points at a declared route`, () => {
      expect(routes.includes(`sites/:projectId/${path}"`), `${name} -> ${path}`).toBe(true);
    });
  }
});
