/**
 * Container health, for whichever process this container is running.
 *
 * The two services expose different health paths on different ports. Probing the wrong one reports
 * a working process as unhealthy, and the platform restarts it forever — so the probe reads the
 * same variable that decided which server started.
 */
export {};

const isRenderer = process.env.SERVICE_ROLE === "renderer";

const port = isRenderer ? (process.env.PUBLIC_RENDERER_PORT ?? "3001") : (process.env.API_PORT ?? "3000");
const path = isRenderer ? "/healthz" : "/api/v1/health";

try {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
