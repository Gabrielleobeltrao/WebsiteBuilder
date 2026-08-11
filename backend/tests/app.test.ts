import { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { ApiProblem } from "../src/middleware/errors";
import { PRIVATE_PROXY_RANGES } from "../src/config/env";
import { testEnv, testLogger } from "./helpers";

const app = () => createApp({ env: testEnv(), logger: testLogger() });

describe("health", () => {
  it("reports ok without a configured database", async () => {
    const response = await request(app()).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(response.body.data.database).toBe("not_configured");
  });

  it("reports degraded with 503 when the database is down", async () => {
    const degraded = createApp({
      env: testEnv(),
      logger: testLogger(),
      healthProbe: () => ({ database: "down" }),
    });
    const response = await request(degraded).get("/api/v1/health");
    expect(response.status).toBe(503);
    expect(response.body.data.status).toBe("degraded");
  });

  it("exposes no configuration or tenant data", async () => {
    const response = await request(app()).get("/api/v1/health");
    expect(Object.keys(response.body.data).sort()).toEqual(["database", "status", "uptimeSeconds"]);
  });
});

describe("error envelope", () => {
  it("returns NOT_FOUND for an unknown route", async () => {
    const response = await request(app()).get("/api/v1/nope");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Resource not found" } });
  });

  it("returns VALIDATION_ERROR for malformed JSON", async () => {
    const response = await request(app())
      .post("/api/v1/health")
      .set("content-type", "application/json")
      .send("{not json");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("maps an ApiProblem to its documented status", async () => {
    const router = Router();
    router.get("/conflict", () => {
      throw new ApiProblem("REVISION_CONFLICT", "Document changed since it was loaded");
    });
    const withRoute = createApp({ env: testEnv(), logger: testLogger(), routers: [{ path: "/t", router }] });
    const response = await request(withRoute).get("/api/v1/t/conflict");
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("REVISION_CONFLICT");
  });

  it("never leaks an unexpected error to the browser", async () => {
    const router = Router();
    router.get("/boom", () => {
      throw new Error("connection string mongodb://user:password@host/db failed");
    });
    const withRoute = createApp({ env: testEnv(), logger: testLogger(), routers: [{ path: "/t", router }] });
    const response = await request(withRoute).get("/api/v1/t/boom");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
    expect(JSON.stringify(response.body)).not.toContain("mongodb://");
  });

  it("rejects a body over the configured limit with 413", async () => {
    const small = createApp({
      env: testEnv({ JSON_BODY_LIMIT: "1kb" }),
      logger: testLogger(),
      routers: [{ path: "/t", router: Router().post("/echo", (_req, res) => res.json({ data: {} })) }],
    });
    const response = await request(small)
      .post("/api/v1/t/echo")
      .send({ blob: "x".repeat(5000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("hardening", () => {
  it("does not advertise the server implementation", async () => {
    const response = await request(app()).get("/api/v1/health");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("cross-origin access", () => {
  /**
   * With the API on its own host, CORS is what decides which application may use a visitor's
   * session. An allowlist that reflects the request's own origin would let any site do it.
   */
  const app = () => createApp({ env: { ...testEnv(), FRONTEND_ORIGIN: "https://app.example.com" }, logger: testLogger() });

  it("allows the configured application origin with credentials", async () => {
    const response = await request(app())
      .get("/api/v1/health")
      .set("Origin", "https://app.example.com");

    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not reflect an origin it was not configured with", async () => {
    const response = await request(app())
      .get("/api/v1/health")
      .set("Origin", "https://evil.example.com");

    expect(response.headers["access-control-allow-origin"]).not.toBe("https://evil.example.com");
  });

  it("permits no cross-origin request at all in production", async () => {
    // Production is same-origin by construction: the browser reaches this API through the gateway
    // on the platform origin. An allowance there would only invite a use the architecture does not
    // have, and any allowance is one exact string away from being a reflection.
    const production = createApp({
      env: { ...testEnv(), NODE_ENV: "production" as const, isProduction: true, FRONTEND_ORIGIN: "https://app.example.com" },
      logger: testLogger(),
    });

    const response = await request(production).get("/api/v1/health").set("Origin", "https://app.example.com");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not allow a lookalike host", async () => {
    const response = await request(app())
      .get("/api/v1/health")
      .set("Origin", "https://app.example.com.evil.test");

    expect(response.headers["access-control-allow-origin"]).not.toBe("https://app.example.com.evil.test");
  });
});

describe("client address behind the gateway", () => {
  /**
   * Better Auth rate-limits per client address. With the proxy untrusted, every request carried the
   * gateway's own address instead, so one shared bucket served every visitor — one person hitting
   * the limit locked out everybody else. This is what stops that.
   */
  const app = () => {
    // Mounted through the same extension point the real routers use, so the request passes the
    // whole middleware stack rather than a route bolted on after the 404 handler.
    const probe = Router();
    probe.get("/", (req, res) => {
      res.json({ ip: req.ip });
    });

    // Supertest connects over loopback, which the production default does not include — nothing
    // reaches the API from there. Naming it here exercises the mechanism without loosening the
    // default, which is asserted separately below.
    return createApp({
      env: { ...testEnv(), trustedProxyCidrs: ["127.0.0.1/8", "::1/128", ...PRIVATE_PROXY_RANGES] },
      logger: testLogger(),
      routers: [{ path: "/whoami", router: probe }],
    });
  };

  it("reads the visitor's address out of the forwarded chain", async () => {
    const response = await request(app())
      .get("/api/v1/whoami")
      .set("X-Forwarded-For", "203.0.113.7");

    expect(response.body.ip).toBe("203.0.113.7");
  });

  it("skips the proxies and keeps the address they were forwarding for", async () => {
    const response = await request(app())
      .get("/api/v1/whoami")
      // Visitor, then Traefik, then the gateway — the shape this deployment produces.
      .set("X-Forwarded-For", "203.0.113.7, 10.0.1.5, 172.18.0.4");

    expect(response.body.ip).toBe("203.0.113.7");
  });

  it("does not count two visitors as one", async () => {
    const instance = app();

    const first = await request(instance).get("/api/v1/whoami").set("X-Forwarded-For", "203.0.113.7");
    const second = await request(instance).get("/api/v1/whoami").set("X-Forwarded-For", "198.51.100.2");

    expect(first.body.ip).not.toBe(second.body.ip);
  });

  it("defaults to the ranges a container gateway can occupy, and nothing wider", () => {
    // `true` would believe any hop, including one a visitor controls.
    expect([...PRIVATE_PROXY_RANGES]).toEqual(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]);
  });

  it("trusts only private ranges, so a public hop is never skipped", async () => {
    // A public address in the chain is a visitor's, not a proxy's. Skipping it would let whoever
    // sent it choose whose bucket to spend.
    const response = await request(app())
      .get("/api/v1/whoami")
      .set("X-Forwarded-For", "203.0.113.7, 198.51.100.99");

    expect(response.body.ip).toBe("198.51.100.99");
  });
});
