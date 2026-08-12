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
    // The API is on one network and it is the private one. The gateway is on that network too, and
    // additionally on the proxy's — it is public, and Traefik cannot reach a container it shares no
    // network with.
    expect(compose.services.backend?.networks).toEqual(["internal"]);
    expect(compose.services.frontend?.networks).toEqual(["internal", "proxy"]);
    expect(compose.networks.internal).toBeDefined();
  });

  it("keeps the backend off the proxy network entirely", () => {
    // Being on it is what would make a stray label or a future mistake publishable. It is not.
    expect(compose.services.backend?.networks).not.toContain("proxy");
    expect(compose.services.renderer?.networks).toContain("proxy");
    expect((compose.networks.proxy as { external?: boolean }).external).toBe(true);
  });

  it("leaves every domain to Coolify's per-service field", () => {
    // Two of the three services carry a domain there; the backend carries none. Declaring one here
    // as well would produce two routers for the same hostname and leave which wins to rule-length
    // arithmetic.
    for (const service of Object.values(compose.services)) {
      const environment = (service.environment ?? {}) as Record<string, string>;
      expect(Object.keys(environment).some((key) => key.startsWith("SERVICE_FQDN"))).toBe(false);
    }
  });

  it("declares a router for the renderer alone, and none for the gateway", () => {
    // The frontend and the renderer are both public, but only the renderer needs a rule a domain
    // field cannot express. The backend needs neither and gets neither.
    const frontend = (compose.services.frontend?.labels ?? []) as string[];
    expect(frontend.some((label) => label.startsWith("traefik.http.routers."))).toBe(false);
    expect(compose.services.backend?.labels).toBeUndefined();
    expect(Array.isArray(compose.services.renderer?.labels)).toBe(true);
  });

  it("tells Traefik which network to dial for every public container", () => {
    /*
     * A container on more than one network leaves that choice to Traefik, and Docker returns them in
     * a randomised order. The gateway sits on the resource network and on `internal`; the proxy is
     * on the first and not the second, so roughly every other container recreation produced a
     * gateway that dialled an address it could not reach and answered 504 after thirty seconds. It
     * read as an application that had stopped working by itself.
     */
    for (const name of ["frontend", "renderer"]) {
      const labels = (compose.services[name]?.labels ?? []) as string[];
      expect(labels, name).toContain("traefik.docker.network=coolify");
    }
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

describe("analytics ingestion", () => {
  const renderer = (compose.services.renderer?.environment ?? {}) as Record<string, string>;

  it("starts with ingestion off, so an open write endpoint is a deliberate act", () => {
    expect(renderer["ANALYTICS_INGESTION_ENABLED"]).toContain(":-false");
  });

  it("configures both rate-limit buckets", () => {
    expect(renderer["ANALYTICS_RATE_LIMIT_PER_ADDRESS"]).toBeDefined();
    expect(renderer["ANALYTICS_RATE_LIMIT_PER_PROJECT"]).toBeDefined();
  });

  it("passes the trusted proxy ranges the address bucket depends on", () => {
    // Without them the renderer trusts no forwarded header, every visitor presents the gateway's
    // address, and an address-keyed limit would throttle the internet as one client.
    expect(renderer["TRUSTED_PROXY_CIDRS"]).toBeDefined();
  });
});

describe("renderer routing", () => {
  const labels = (compose.services.renderer?.labels ?? []) as string[];
  const label = (key: string) => labels.find((entry) => entry.startsWith(`${key}=`))?.split("=").slice(1).join("=");

  it("sends traffic to the renderer's own port", () => {
    expect(label("traefik.http.services.wb-renderer.loadbalancer.server.port")).toBe("3001");
  });

  it("adds no router for the technical origin, which is the renderer's own domain field", () => {
    // Coolify generates that router. A second one for the same hostname is the ambiguity this file
    // exists to prevent.
    expect(labels.some((entry) => entry.includes("wb-renderer-origin"))).toBe(false);
  });

  it("matches project subdomains but never a bare root domain", () => {
    const rule = label("traefik.http.routers.wb-renderer-projects.rule") ?? "";

    // A label is required before the root domain, and the pattern is anchored at both ends, so a
    // longer hostname cannot match by accident.
    expect(rule).toContain("^[a-z0-9][a-z0-9-]*\\.");
    // Go's end-of-text anchor rather than `$`: a `$` in a compose file has to be escaped as `$$`,
    // and the escape survives into the label on a deploy path that does not interpolate.
    expect(rule).toContain("\\z");
  });

  it("interpolates nothing inside a Traefik label", () => {
    // A deployed container was found carrying `HostRegexp(...${PLATFORM_ROOT_DOMAIN_REGEX}$$)` as
    // literal text, matching no hostname, and a `traefik.docker.network` of
    // `${COOLIFY_PROXY_NETWORK:-coolify}` — a network that does not exist. The deploy applies these
    // labels without expanding them, so a variable here is not a configuration point, it is a
    // hostname nobody can reach. A default value does not help: nothing expands that either.
    for (const entry of labels) {
      expect(entry, entry).not.toContain("${");
    }
  });

  it("ranks the wildcard below every exact-host router on the machine", () => {
    // Traefik defaults to rule length, under which a long regexp outranks a short exact host. Under
    // that default the project wildcard would outrank both of this platform's own domains — and any
    // other application's on the same VPS.
    const priority = Number(label("traefik.http.routers.wb-renderer-projects.priority"));
    expect(priority).toBeLessThanOrEqual(10);
  });

  it("answers project subdomains on plain HTTP too, with a redirect", () => {
    // A router only on the https entrypoint leaves http unmatched, and Traefik's unmatched response
    // is a 404 — indistinguishable from a site that was never published. Both routers must cover the
    // same hostnames, or the redirect sends part of them somewhere that does not answer.
    // Compared after dropping the `:?message` clause, which only the first occurrence of a required
    // variable carries. What must match is the pattern and the variable, which is what is left.
    const pattern = (value: string | undefined) => (value ?? "").replace(/:\?[^}]*/, "");
    expect(pattern(label("traefik.http.routers.wb-renderer-projects-http.rule"))).toBe(
      pattern(label("traefik.http.routers.wb-renderer-projects.rule")),
    );
    expect(label("traefik.http.routers.wb-renderer-projects-http.entrypoints")).toBe("http");
    expect(label("traefik.http.routers.wb-renderer-projects-http.middlewares")).toBe("wb-https-redirect");
    expect(label("traefik.http.middlewares.wb-https-redirect.redirectscheme.scheme")).toBe("https");
  });

  it("asks for no certificate it cannot be issued", () => {
    // A resolver here would mean one ACME order per published hostname, each answering a challenge
    // on a hostname whose certificate does not exist yet: a queue of failures ending in a rate
    // limit. The certificate for these hostnames is Cloudflare's, terminated at their edge.
    expect(label("traefik.http.routers.wb-renderer-projects.tls")).toBe("true");
    expect(label("traefik.http.routers.wb-renderer-projects.tls.certresolver")).toBeUndefined();
  });

  it("adds no catch-all that would claim hostnames this platform knows nothing about", () => {
    // A rule matching everything belongs to a deliberate, documented decision on the VPS, not to a
    // file that deploys to it.
    for (const entry of labels) {
      expect(entry).not.toMatch(/HostRegexp\(`\^?\.[*+]/);
    }
  });

  it("attaches to the proxy network Traefik is on", () => {
    // A router that points at a container it cannot reach produces a 502 with no obvious cause.
    expect(label("traefik.docker.network")).toBeTruthy();
  });
});
