import { apiController } from "@/http/controller";

export default apiController({
  name: "tokens.create",
  method: "POST",
  path: "/api/v1/tokens",
  route: (request) => ({ operation: "tokens.create", payload: request.body, status: 201 }),
});
