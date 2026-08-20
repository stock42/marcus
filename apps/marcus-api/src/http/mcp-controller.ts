import { Dependencies, type ControllerType } from "s42-core";
import type { MarcusApi, S42Request } from "@/index";

export function mcpController(method: "GET" | "POST" | "DELETE"): ControllerType {
  return {
    name: `mcp.${method.toLowerCase()}`,
    version: "1.0.0",
    method,
    path: "/mcp",
    async handler(request) {
      const api = Dependencies.get<MarcusApi>("app");
      if (api === null) throw new Error("MarcusApi context is not initialized");
      return api.dispatchMcp(request as S42Request);
    },
  };
}
