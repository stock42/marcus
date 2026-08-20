import { loadStudioGatewayConfig } from "./config";
import { MarcusStudioGateway } from "./server";

export { loadStudioGatewayConfig, type StudioGatewayConfig } from "./config";
export { MarcusStudioGateway } from "./server";

if (import.meta.main) {
  const config = await loadStudioGatewayConfig();
  const gateway = new MarcusStudioGateway(config);
  const server = gateway.start();
  process.stdout.write(`${JSON.stringify({ level: "info", event: "marcus-studio.ready", address: { hostname: config.host, port: server.port }, model: config.providerModel })}\n`);
  const stop = async () => {
    await gateway.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
}
