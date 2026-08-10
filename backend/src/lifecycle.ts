import type { Server } from "node:http";

import type { Logger } from "pino";

/**
 * Stops accepting connections, lets in-flight requests finish, then exits. The timeout exists so a
 * hung connection cannot keep a replaced container alive through a deployment.
 */
export function installGracefulShutdown(options: {
  server: Server;
  logger: Logger;
  timeoutMs: number;
  onShutdown?: () => Promise<void>;
}): () => void {
  const { server, logger, timeoutMs, onShutdown } = options;
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs }, "graceful shutdown timed out, exiting");
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    server.close(async (closeError) => {
      if (closeError) logger.error({ err: closeError }, "error while closing the server");
      try {
        await onShutdown?.();
      } catch (error) {
        logger.error({ err: error }, "error during shutdown hook");
      }
      clearTimeout(forceExit);
      process.exit(closeError ? 1 : 0);
    });
  };

  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
  for (const signal of signals) process.on(signal, shutdown);

  return () => {
    for (const signal of signals) process.off(signal, shutdown);
  };
}
