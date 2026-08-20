export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerBackofficeLogging } = await import("@/lib/marcus/logger-node");
    registerBackofficeLogging();
  }
}
