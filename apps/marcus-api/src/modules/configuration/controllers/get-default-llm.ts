import { apiController } from "@/http/controller";

export default apiController({
  name: "configuration.default-llm.get",
  method: "GET",
  path: "/api/v1/config/default-llm",
  route: { operation: "configuration.defaultLlm.get", payload: {} },
});
