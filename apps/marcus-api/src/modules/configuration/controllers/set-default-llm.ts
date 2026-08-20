import { apiController } from "@/http/controller";

export default apiController({
  name: "configuration.default-llm.set",
  method: "PUT",
  path: "/api/v1/config/default-llm",
  route: (request) => ({ operation: "configuration.defaultLlm.set", payload: request.body }),
});
