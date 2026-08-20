import { apiController } from "@/http/controller";

export default apiController({
  name: "approvals.list",
  method: "GET",
  path: "/api/v1/projects/:project/approvals",
  route: (request) => ({ operation: "approvals.list", payload: request.query, projectId: request.params.project }),
});
