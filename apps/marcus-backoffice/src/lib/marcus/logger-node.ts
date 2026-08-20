import { backofficeLogger } from "./logger";

const instrumentationState = globalThis as typeof globalThis & { __marcusBackofficeLogging?: boolean };

export function registerBackofficeLogging(): void {
  if (instrumentationState.__marcusBackofficeLogging === true) return;
  instrumentationState.__marcusBackofficeLogging = true;
  backofficeLogger.info("backoffice.started", {
    host: process.env.HOSTNAME ?? "127.0.0.1",
    port: Number(process.env.PORT ?? process.env.MARCUS_BACKOFFICE_PORT ?? 6636),
  });
  process.on("uncaughtExceptionMonitor", (error) => backofficeLogger.error("process.uncaught", { error }));
  process.on("unhandledRejection", (error) => backofficeLogger.error("process.unhandled-rejection", { error }));
}
