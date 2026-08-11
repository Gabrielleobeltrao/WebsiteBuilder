import { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { ApiProblem } from "../src/middleware/errors";
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

  it("does not allow a lookalike host", async () => {
    const response = await request(app())
      .get("/api/v1/health")
      .set("Origin", "https://app.example.com.evil.test");

    expect(response.headers["access-control-allow-origin"]).not.toBe("https://app.example.com.evil.test");
  });
});
