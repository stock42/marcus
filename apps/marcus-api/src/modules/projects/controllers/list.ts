import { apiController } from "@/http/controller";

export default apiController({
  name: "projects.list",
  method: "GET",
  path: "/api/v1/projects",
  route: (request) => ({ operation: "projects.list", payload: request.query.status === undefined ? {} as Record<string, never> : { status: request.query.status } }),
});
