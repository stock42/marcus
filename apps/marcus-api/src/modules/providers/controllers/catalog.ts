import { apiController } from "@/http/controller";

export default apiController({
  name: "providers.catalog",
  method: "GET",
  path: "/api/v1/providers/catalog",
  route: { operation: "providers.catalog", payload: {} },
});
