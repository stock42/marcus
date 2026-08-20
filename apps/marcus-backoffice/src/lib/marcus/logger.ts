import { createMarcusFileLogger, MemoryLogSink, SafeLogger } from "@marcus/observability";

export const backofficeLogger = process.env.NODE_ENV === "test"
  ? new SafeLogger({ source: "marcus-backoffice", sink: new MemoryLogSink() })
  : createMarcusFileLogger("marcus-backoffice", {
      ...(process.env.MARCUS_LOGS_DIR === undefined ? {} : { logsDir: process.env.MARCUS_LOGS_DIR }),
    });
