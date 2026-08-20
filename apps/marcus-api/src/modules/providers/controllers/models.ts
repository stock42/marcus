import { apiController } from "@/http/controller";

export default apiController({
  name: "providers.models",
  method: "GET",
  path: "/api/v1/providers/:provider/models",
  route: (request) => ({ operation: "providers.models", payload: { provider: request.params.provider } }),
});
