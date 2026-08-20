import { apiController } from "@/http/controller";

export default apiController({
  name: "system.overview",
  method: "GET",
  path: "/api/v1/system/overview",
  route: { operation: "system.overview", payload: {} },
});
