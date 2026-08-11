import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installGracefulShutdown } from "../src/lifecycle";
import { testLogger } from "./helpers";

/**
 * Shutdown behaviour, which a deploy exercises every single time.
 *
 * Nothing here spawns a process: the handler is installed on this one and the signal is emitted
 * directly, so the sequence is observable rather than inferred from a container that vanished.
 * `process.exit` is stubbed for the same reason — the point is what was done before exiting.
 */
let servers: Server[] = [];
let detach: (() => void) | null = null;

function listeningServer(): Promise<Server> {
  const server = createServer((_req, res) => res.end("ok"));
  servers.push(server);
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

afterEach(async () => {
  detach?.();
  detach = null;
  for (const server of servers) await new Promise((resolve) => server.close(() => resolve(null)));
  servers = [];
  vi.restoreAllMocks();
});

describe("graceful shutdown", () => {
  it("closes the server and runs the shutdown hook before exiting", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const onShutdown = vi.fn(async () => {});
    const server = await listeningServer();

    detach = installGracefulShutdown({ server, logger: testLogger(), timeoutMs: 5_000, onShutdown });
    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalled());
    expect(server.listening).toBe(false);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("stops listening, so a proxy stops sending it new work", async () => {
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const server = await listeningServer();

    detach = installGracefulShutdown({ server, logger: testLogger(), timeoutMs: 5_000 });
    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(server.listening).toBe(false));
  });

  it("ignores a second signal rather than tearing down twice", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const onShutdown = vi.fn(async () => {});
    const server = await listeningServer();

    detach = installGracefulShutdown({ server, logger: testLogger(), timeoutMs: 5_000, onShutdown });
    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    // An impatient operator pressing Ctrl-C twice must not run database teardown concurrently.
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it("exits anyway when a hook hangs past the grace period", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const server = await listeningServer();

    detach = installGracefulShutdown({
      server,
      logger: testLogger(),
      timeoutMs: 20,
      // A connection that never drains would otherwise hold the container past the platform's own
      // grace period, and it would be killed mid-write instead of mid-nothing.
      onShutdown: () => new Promise(() => {}),
    });
    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { timeout: 2_000 });
  });

  it("handles SIGINT the same way, because a local Ctrl-C is the same shutdown", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const server = await listeningServer();

    detach = installGracefulShutdown({ server, logger: testLogger(), timeoutMs: 5_000 });
    process.emit("SIGINT", "SIGINT");

    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
  });
});
