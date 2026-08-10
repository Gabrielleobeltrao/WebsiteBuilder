import { EnvironmentError, loadEnv } from "./config/env";
import { createLogger } from "./config/logger";
import { installGracefulShutdown } from "./lifecycle";
import { createRendererApp } from "./renderer/app";

function start(): void {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(env).child({ service: "public-renderer" });
  const app = createRendererApp({ env, logger });
  const server = app.listen(env.PUBLIC_RENDERER_PORT, () => {
    logger.info({ port: env.PUBLIC_RENDERER_PORT, env: env.NODE_ENV }, "public renderer listening");
  });

  installGracefulShutdown({ server, logger, timeoutMs: env.SHUTDOWN_TIMEOUT_MS });
}

start();
