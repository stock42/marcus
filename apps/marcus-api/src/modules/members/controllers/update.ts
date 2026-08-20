import { apiController } from "@/http/controller";

export default apiController({
  name: "members.update",
  method: "PUT",
  path: "/api/v1/projects/:project/members/:user",
  route: (request) => ({ operation: "projectMembers.update", payload: { ...request.body, user: request.params.user }, projectId: request.params.project }),
});
