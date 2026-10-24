import type { Server } from "node:http";

/** Drain standalone HTTP work before closing shared resources, with one deadline. */
export function createShutdown(
  server: Server,
  closeResources: () => Promise<void>,
  finish: (code: number) => void,
  log: { info: (message: string) => void; error: (message: string) => void },
  timeoutMs = 10_000,
): (signal: string) => Promise<void> {
  let running: Promise<void> | undefined;
  return signal => {
    if (running) return running;
    running = new Promise<void>(resolve => {
      let finished = false;
      const done = (code: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        finish(code);
        resolve();
      };
      const deadline = setTimeout(() => {
        log.error("Shutdown deadline exceeded");
        try { server.closeAllConnections(); } finally { done(1); }
      }, timeoutMs);
      log.info(`Draining HTTP server after ${signal}`);
      server.close(error => {
        void (async () => {
          try {
            await closeResources();
            done(error ? 1 : 0);
          } catch {
            // Driver exceptions can include credentials; log only the outcome.
            log.error("Shutdown resource cleanup failed");
            done(1);
          }
        })();
      });
    });
    return running;
  };
}
