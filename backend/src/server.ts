import { createApp } from "./app";
import { EnvironmentError, loadEnv } from "./config/env";
import { createLogger } from "./config/logger";
import { installGracefulShutdown } from "./lifecycle";

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

  const logger = createLogger(env);
  const app = createApp({ env, logger });
  const server = app.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT, env: env.NODE_ENV }, "API listening");
  });

  installGracefulShutdown({ server, logger, timeoutMs: env.SHUTDOWN_TIMEOUT_MS });
}

start();
