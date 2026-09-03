import type { Express } from "express";
import type { Server } from "node:http";
import type { Logger } from "pino";

/**
 * Starts a server, and says one true thing about the outcome.
 *
 * Two failures this replaces. Node's own answer to a busy port is an unhandled `EADDRINUSE` event —
 * a twenty-line stack naming `net.js` and not the thing a person has to change; on a machine running
 * several projects that is the likeliest way to fail to start, and it reads as a crash in the
 * product. And listening with no host asks for both address families, so a port held on one of them
 * lets the success callback run *and* the error fire: the log said the API was listening while the
 * port was taken.
 *
 * So the success line is deferred past the error. Whichever outcome is real is the only one printed.
 */
export function listenOrExplain(
  app: Express,
  options: { port: number; variable: string; service: string; logger: Logger; environment: string },
): Server {
  const { port, variable, service, logger, environment } = options;

  const server = app.listen(port, () => {
    // One turn of the loop later, so a bind that failed on the other address family has already
    // reported itself and ended the process.
    setImmediate(() => {
      if (server.listening) logger.info({ port, env: environment }, `${service} listening`);
    });
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") throw error;

    process.stderr.write(
      `\n${service} cannot start: port ${port} is already in use.\n` +
        `Something else on this machine is listening there — find it with:\n` +
        `  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
        `Or move this service by setting ${variable} in backend/.env.\n\n`,
    );
    process.exit(1);
  });

  return server;
}
