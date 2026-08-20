import { apiController } from "@/http/controller";

export default apiController({
  name: "providers.create",
  method: "POST",
  path: "/api/v1/providers",
  route: (request) => ({ operation: "providers.add", payload: request.body, status: 201 }),
});
