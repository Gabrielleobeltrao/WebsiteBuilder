import { describe, expect, it } from "vitest";

import { auditBundle, auditRoutePerformance, PERFORMANCE_BUDGETS, type RouteAssets } from "./performance";

const route = (overrides: Partial<RouteAssets> = {}): RouteAssets => ({
  path: "/",
  documentBytes: 1000,
  images: [],
  fontFiles: ["inter-400.woff2"],
  ...overrides,
});

const image = (overrides: Partial<RouteAssets["images"][number]> = {}) => ({
  elementId: "e1",
  bytes: 50_000,
  hasDimensions: true,
  eager: false,
  ...overrides,
});

describe("what is measured", () => {
  it("reports nothing for a page inside every budget", () => {
    expect(auditRoutePerformance(route({ images: [image()] }))).toEqual([]);
  });

  it("carries the measurement and the budget, so a finding can be argued with", () => {
    const [finding] = auditRoutePerformance(route({ documentBytes: 900_000 }));

    expect(finding?.measured).toBe(900_000);
    expect(finding?.budget).toBe(PERFORMANCE_BUDGETS.documentBytes);
  });

  it("names the element responsible, not only the page", () => {
    const [finding] = auditRoutePerformance(route({ images: [image({ elementId: "hero", bytes: 900_000 })] }));
    expect(finding?.elementId).toBe("hero");
  });

  it("says what to do rather than only what is wrong", () => {
    const findings = auditRoutePerformance(route({ images: [image({ bytes: 900_000 })] }));
    expect(findings[0]?.detail).toMatch(/Re-uploading/);
  });
});

describe("layout shift", () => {
  it("treats a missing size as an error, not a suggestion", () => {
    // A page that moves while loading makes a visitor tap the wrong thing.
    const findings = auditRoutePerformance(route({ images: [image({ hasDimensions: false })] }));
    const finding = findings.find((entry) => entry.code === "missing-dimensions");

    expect(finding?.severity).toBe("error");
  });

  it("accepts an image that can reserve its space", () => {
    const findings = auditRoutePerformance(route({ images: [image({ hasDimensions: true })] }));
    expect(findings.some((entry) => entry.code === "missing-dimensions")).toBe(false);
  });
});

describe("weight", () => {
  it("adds up the images on a page rather than judging each alone", () => {
    const images = Array.from({ length: 6 }, (_, index) => image({ elementId: `e${index}`, bytes: 300_000 }));
    const findings = auditRoutePerformance(route({ images }));

    expect(findings.some((entry) => entry.code === "route-image-weight")).toBe(true);
  });

  it("counts distinct font files, not repeated references to one", () => {
    const repeated = route({ fontFiles: Array.from({ length: 10 }, () => "inter-400.woff2") });
    expect(auditRoutePerformance(repeated).some((entry) => entry.code === "too-many-fonts")).toBe(false);

    const many = route({ fontFiles: ["a", "b", "c", "d", "e"] });
    expect(auditRoutePerformance(many).some((entry) => entry.code === "too-many-fonts")).toBe(true);
  });

  it("reports too many images competing for the first connection", () => {
    const images = Array.from({ length: 4 }, (_, index) => image({ elementId: `e${index}`, eager: true }));
    expect(auditRoutePerformance(route({ images })).some((entry) => entry.code === "too-many-eager-images")).toBe(true);
  });
});

describe("bundle", () => {
  it("passes a bundle inside budget", () => {
    expect(auditBundle(100_000)).toEqual([]);
  });

  it("reports one over budget with the measurement attached", () => {
    const [finding] = auditBundle(600_000);

    expect(finding?.measured).toBe(600_000);
    expect(finding?.budget).toBe(PERFORMANCE_BUDGETS.applicationBundleBytes);
  });

  it("holds a published site to a far stricter budget than the editor", () => {
    // Different people, different circumstances: one chose to open a design tool behind a login,
    // the other landed on a customer's page.
    expect(PERFORMANCE_BUDGETS.publishedSiteJavaScriptBytes).toBeLessThan(
      PERFORMANCE_BUDGETS.applicationBundleBytes / 4,
    );

    expect(auditBundle(100_000, "published-site")).not.toEqual([]);
    expect(auditBundle(100_000, "application")).toEqual([]);
  });

  it("holds the analytics tracker to a stricter budget than the page it runs on", () => {
    // The tracker is charged against a visitor who did not ask for it, so it is bounded well inside
    // the page's own allowance rather than being permitted to consume it.
    expect(PERFORMANCE_BUDGETS.publishedSiteTrackerBytes).toBeLessThan(
      PERFORMANCE_BUDGETS.publishedSiteJavaScriptBytes / 2,
    );
  });
});

describe("honesty", () => {
  it("makes no claim about load time or a score", () => {
    // Those depend on a device and a network this code cannot see, and a precise-looking invented
    // number is worse than none because someone will act on it.
    const text = JSON.stringify([
      ...auditRoutePerformance(route({ documentBytes: 900_000, images: [image({ bytes: 900_000 })] })),
      ...auditBundle(400_000),
    ]);

    for (const claim of ["seconds", "LCP", "score", "Lighthouse", "faster"]) {
      expect(text).not.toContain(claim);
    }
  });
});
