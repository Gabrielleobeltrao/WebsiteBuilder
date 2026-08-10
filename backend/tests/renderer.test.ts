import request from "supertest";
import { describe, expect, it } from "vitest";

import { createRendererApp } from "../src/renderer/app";
import { testEnv, testLogger } from "./helpers";

const renderer = () => createRendererApp({ env: testEnv(), logger: testLogger() });

describe("public renderer", () => {
  it("answers health without requiring a site hostname", async () => {
    const response = await request(renderer()).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });

  it("returns a neutral 404 for an unknown host, revealing no tenant", async () => {
    const response = await request(renderer()).get("/").set("Host", "unknown.example.com");
    expect(response.status).toBe(404);
    expect(response.text).toBe("Not found");
  });
});
