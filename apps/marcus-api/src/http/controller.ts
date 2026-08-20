import { Dependencies, type ControllerType } from "s42-core";
import type { ApiRoute, MarcusApi, S42Request } from "@/index";

type ApiControllerDefinition = Pick<ControllerType, "name" | "method" | "path"> & {
  route: ApiRoute | ((request: S42Request) => ApiRoute);
};

export function apiController(definition: ApiControllerDefinition): ControllerType {
  const { route, ...controller } = definition;
  return {
    ...controller,
    version: "1.0.0",
    async handler(request) {
      const api = Dependencies.get<MarcusApi>("app");
      if (api === null) throw new Error("MarcusApi context is not initialized");
      const normalized = request as S42Request;
      return api.dispatchHttp(normalized, typeof route === "function" ? route(normalized) : route);
    },
  };
}

export function queryValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try { return decodeURIComponent(value.replaceAll("+", " ")); }
  catch { return value.replaceAll("+", " "); }
}
