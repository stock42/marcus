import { apiController } from "@/http/controller";

export default apiController({
  name: "projects.create",
  method: "POST",
  path: "/api/v1/projects",
  route: (request) => ({ operation: "projects.create", payload: request.body, status: 201 }),
});
