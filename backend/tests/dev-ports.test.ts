import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env";

/**
 * One port contract, stated in six places that have to agree.
 *
 * The conventional numbers — 3000, 3001, 5173 — are what most projects take, so on a machine running
 * more than one of them `npm run dev` collided with whatever was already there. Moving them is only
 * a fix if every file that names one moves together: a web server on one port and a cookie issued
 * for another is a login that fails for a reason nobody can see.
 *
 * The container is the deliberate exception. Its ports are stated in the image rather than defaulted
 * so the compose file, the gateway and the health check all name the same number; the application's
 * own defaults are development numbers and never reach production.
 */

const DEV = { web: 7410, api: 7411, renderer: 7412, e2ePreview: 7413 } as const;
const CONTAINER = { api: 3000, renderer: 3001 } as const;

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/**
 * The environment as a process actually presents it: strings, or nothing at all.
 *
 * `testEnv()` returns the *parsed* environment, where a port is a number — spreading that back into
 * `loadEnv` would be handing the parser its own output and testing nothing about how a real
 * `process.env` is read. An absent variable is `undefined` here for the same reason: that is what a
 * missing one looks like, and it is the case these tests are about.
 */
function rawEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PLATFORM_ROOT_DOMAIN: "localhost",
    ...overrides,
  };
}

describe("the development contract", () => {
  it("is what the application listens on when nothing is configured", () => {
    const env = loadEnv(rawEnv());

    expect(env.API_PORT).toBe(DEV.api);
    expect(env.PUBLIC_RENDERER_PORT).toBe(DEV.renderer);
    expect(env.WEB_PORT).toBe(DEV.web);
  });

  it("is what the web server and its API proxy default to", () => {
    const vite = read("frontend/vite.config.ts");

    expect(vite).toContain(`env.WEB_PORT || ${DEV.web}`);
    expect(vite).toContain(`env.API_PORT || ${DEV.api}`);
  });

  it("is what the browser suite starts", () => {
    const playwright = read("frontend/playwright.config.ts");
    const servers = read("frontend/e2e/support/start-servers.mjs");

    expect(playwright).toContain(`const PORT = ${DEV.e2ePreview};`);
    expect(playwright).toContain(`const RENDERER_PORT = ${DEV.renderer};`);
    expect(playwright).toContain(`http://localhost:${DEV.api}/api/v1/health`);
    expect(servers).toContain(`"${DEV.api}"`);
    expect(servers).toContain(`"${DEV.renderer}"`);
    expect(servers).toContain(`http://localhost:${DEV.e2ePreview}`);
  });

  it("is what every example file tells a developer to use", () => {
    for (const path of [".env.example", "frontend/.env.example", "backend/.env.example"]) {
      const example = read(path);
      const ports = [...example.matchAll(/^(?:API_PORT|PUBLIC_RENDERER_PORT|WEB_PORT)=(\d+)$/gm)].map((match) =>
        Number(match[1]),
      );

      expect(ports.length, `${path} names no ports`).toBeGreaterThan(0);
      for (const port of ports) {
        expect(Object.values(DEV), `${path} names ${port}`).toContain(port);
      }
    }
  });

  it("is what the README and the runbook tell somebody to check", () => {
    for (const path of ["README.md", ".claude/skills/project-runbook/references/commands.md"]) {
      const doc = read(path);

      expect(doc, path).toContain(`http://localhost:${DEV.api}/api/v1/health`);
      expect(doc, path).toContain(`http://localhost:${DEV.renderer}/healthz`);
      expect(doc, path).toContain(`http://localhost:${DEV.web}/`);
    }
  });
});

describe("the container contract", () => {
  it("states its ports rather than inheriting a development default", () => {
    const dockerfile = read("backend/Dockerfile");

    // Without this the image would listen on a development port while EXPOSE, the compose file and
    // the gateway all named another — and the health check would be the only thing that noticed.
    expect(dockerfile).toContain(`ENV API_PORT=${CONTAINER.api}`);
    expect(dockerfile).toContain(`ENV PUBLIC_RENDERER_PORT=${CONTAINER.renderer}`);
    expect(dockerfile).toContain(`EXPOSE ${CONTAINER.api}`);
    expect(dockerfile).toContain(`EXPOSE ${CONTAINER.renderer}`);
  });

  it("checks the health of the port it actually listens on", () => {
    const dockerfile = read("backend/Dockerfile");

    expect(dockerfile).toContain(`process.env.API_PORT||${CONTAINER.api}`);
    expect(dockerfile).toContain(`process.env.PUBLIC_RENDERER_PORT||${CONTAINER.renderer}`);
  });

  it("keeps production naming its own values explicitly", () => {
    const compose = read("docker-compose.production.yml");

    expect(compose).toContain(`API_PORT: ${CONTAINER.api}`);
    expect(compose).toContain(`PUBLIC_RENDERER_PORT: ${CONTAINER.renderer}`);
  });
});

describe("moving a port", () => {
  it("moves the origins that follow it, so a cookie is issued for the page being served", () => {
    const env = loadEnv(rawEnv({ WEB_PORT: "9999" }));

    expect(env.WEB_PORT).toBe(9999);
    expect(env.FRONTEND_ORIGIN).toBe("http://localhost:9999");
  });

  it("is honoured over the default on every service", () => {
    const env = loadEnv(rawEnv({ API_PORT: "9101", PUBLIC_RENDERER_PORT: "9102", WEB_PORT: "9103" }));

    expect([env.API_PORT, env.PUBLIC_RENDERER_PORT, env.WEB_PORT]).toEqual([9101, 9102, 9103]);
  });
});
