import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * The deployment topology, asserted against the files that produce it.
 *
 * These exist because the previous topology was wrong in ways nothing caught: the compose file's
 * comments promised a same-origin API while the file itself published a public API hostname, and
 * the backend image carried two `CMD` lines so the renderer silently started the API. Both survived
 * review and a deploy. A comment is not a contract; this file is.
 */
const ROOT = join(import.meta.dirname, "..", "..");

const compose = parse(readFileSync(join(ROOT, "docker-compose.production.yml"), "utf8")) as {
  services: Record<string, Record<string, unknown>>;
  networks: Record<string, unknown>;
};

const dockerfile = (name: string) => readFileSync(join(ROOT, name), "utf8");

describe("services", () => {
  it("defines exactly the three services the architecture describes", () => {
    expect(Object.keys(compose.services).sort()).toEqual(["backend", "frontend", "renderer"]);
  });

  it("builds every image from the repository root", () => {
    // Both images need the root lockfile and packages/shared, which Docker cannot reach from a
    // narrower context.
    for (const service of Object.values(compose.services)) {
      expect((service.build as { context: string }).context).toBe(".");
    }
  });

  it("builds the API and the renderer from distinct targets of one Dockerfile", () => {
    const backend = compose.services.backend?.build as { dockerfile: string; target: string };
    const renderer = compose.services.renderer?.build as { dockerfile: string; target: string };

    expect(backend.dockerfile).toBe("backend/Dockerfile");
    expect(renderer.dockerfile).toBe("backend/Dockerfile");
    expect(backend.target).toBe("api");
    expect(renderer.target).toBe("renderer");
  });
});

describe("the API is private", () => {
  it("has no public route of any kind", () => {
    const backend = compose.services.backend ?? {};
    const environment = (backend.environment ?? {}) as Record<string, string>;

    // A hostname here would undo the single-origin design silently: everything would still work,
    // and the API would simply also be reachable from the internet.
    expect(Object.keys(environment).some((key) => key.startsWith("SERVICE_FQDN"))).toBe(false);
    expect(backend.ports).toBeUndefined();
    expect(backend.expose).toEqual(["3000"]);
  });

  it("is reachable only on the private network the gateway shares", () => {
    for (const name of ["frontend", "backend"]) {
      expect(compose.services[name]?.networks).toEqual(["internal"]);
    }
    expect(compose.networks.internal).toBeDefined();
  });

  it("publishes the frontend and the renderer, and only those", () => {
    const routed = Object.entries(compose.services)
      .filter(([, service]) =>
        Object.keys((service.environment ?? {}) as Record<string, string>).some((key) =>
          key.startsWith("SERVICE_FQDN"),
        ),
      )
      .map(([name]) => name);

    expect(routed.sort()).toEqual(["frontend", "renderer"]);
  });
});

describe("secrets reach only the service that needs them", () => {
  const environmentOf = (name: string) => (compose.services[name]?.environment ?? {}) as Record<string, string>;

  it("gives the session secret to the API alone", () => {
    // The renderer has no sessions. A signing secret it cannot use only widens what a compromise
    // of that container reaches.
    expect(environmentOf("backend").BETTER_AUTH_SECRET).toBeDefined();
    expect(environmentOf("renderer").BETTER_AUTH_SECRET).toBeUndefined();
    expect(environmentOf("frontend").BETTER_AUTH_SECRET).toBeUndefined();
  });

  it("gives the frontend no backend or provider configuration at all", () => {
    const frontend = environmentOf("frontend");

    // Everything it received would be compiled into a bundle or readable in `docker inspect`.
    for (const key of ["MONGODB_URI", "CLOUDFLARE_API_TOKEN", "BETTER_AUTH_SECRET"]) {
      expect(frontend[key]).toBeUndefined();
    }
  });

  it("passes no VITE_ build argument, because none carries a public value any more", () => {
    const build = compose.services.frontend?.build as { args?: Record<string, string> };
    expect(build.args).toBeUndefined();
  });
});

describe("required configuration stops a deployment rather than defaulting", () => {
  const raw = readFileSync(join(ROOT, "docker-compose.production.yml"), "utf8");

  it("refuses to start without the values that cannot be guessed", () => {
    // `${VAR:?message}` fails the deployment. A default would start a service configured with an
    // empty string, which fails later and further from the cause.
    for (const variable of [
      "PLATFORM_PUBLIC_ORIGIN",
      "MONGODB_URI",
      "MONGODB_DB_NAME",
      "BETTER_AUTH_SECRET",
      "PLATFORM_ROOT_DOMAIN",
      "PUBLIC_RENDERER_ORIGIN",
    ]) {
      expect(raw).toMatch(new RegExp(`\\$\\{${variable}:\\?`));
    }
  });

  it("keeps Cloudflare optional, because the platform runs without customer domains", () => {
    expect(raw).toMatch(/\$\{CLOUDFLARE_API_TOKEN:-\}/);
  });
});

describe("the backend image", () => {
  const source = dockerfile("backend/Dockerfile");

  it("gives each target exactly one command", () => {
    // Two `CMD` lines in one stage is not an error Docker reports: it takes the last and the other
    // becomes a comment nobody reads. That is how the renderer came to start the API.
    const targets = source.split(/^FROM /m).slice(1);
    const finals = targets.filter((target) => /^CMD /m.test(target));

    for (const target of finals) {
      expect(target.match(/^CMD /gm)?.length).toBe(1);
    }
  });

  it("starts a different process in each target", () => {
    const api = source.slice(source.indexOf("AS api"));
    const renderer = source.slice(source.indexOf("AS renderer"));

    expect(api).toContain('CMD ["node", "backend/dist/server.js"]');
    expect(renderer).toContain('CMD ["node", "backend/dist/renderer-server.js"]');
  });

  it("probes each service's own health endpoint and port", () => {
    const api = source.slice(source.indexOf("AS api"), source.indexOf("AS renderer"));
    const renderer = source.slice(source.indexOf("AS renderer"));

    expect(api).toContain("/api/v1/health");
    expect(api).toContain("API_PORT");
    expect(renderer).toContain("/healthz");
    expect(renderer).toContain("PUBLIC_RENDERER_PORT");
  });

  it("runs as a non-root user", () => {
    expect(source).toContain("USER node");
  });

  it("uses exec-form CMD, so node receives SIGTERM directly", () => {
    // Behind a shell it would not, and the graceful shutdown both services implement would be
    // skipped on every deploy.
    for (const command of source.match(/^CMD .*/gm) ?? []) {
      expect(command).toMatch(/^CMD \[/);
    }
  });
});

describe("the gateway", () => {
  const nginx = readFileSync(join(ROOT, "frontend", "nginx.conf"), "utf8");

  it("proxies /api to the private backend", () => {
    expect(nginx).toContain("location /api/");
    expect(nginx).toContain("proxy_pass http://backend:3000;");
  });

  it("matches /api before the SPA fallback", () => {
    // Reversed, a backend outage would return index.html with 200 and every client would parse a
    // login page as JSON.
    expect(nginx.indexOf("location /api/")).toBeLessThan(nginx.indexOf("location / {"));
  });

  it("never intercepts a backend failure into an HTML page", () => {
    expect(nginx).toContain("proxy_intercept_errors off;");
  });

  it("trusts a forwarded client address only from the private network", () => {
    expect(nginx).not.toContain("set_real_ip_from 0.0.0.0/0");
    expect(nginx).toContain("set_real_ip_from 10.0.0.0/8");
  });

  it("keeps its own health independent of the API", () => {
    const health = nginx.slice(nginx.indexOf("location = /healthz"));
    expect(health).not.toContain("proxy_pass");
  });
});
