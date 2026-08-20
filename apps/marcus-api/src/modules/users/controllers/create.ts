import { apiController } from "@/http/controller";

export default apiController({
  name: "users.create",
  method: "POST",
  path: "/api/v1/users",
  route: (request) => ({ operation: "users.create", payload: request.body, status: 201 }),
});
