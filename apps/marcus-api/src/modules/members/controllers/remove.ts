import { apiController } from "@/http/controller";

export default apiController({
  name: "members.remove",
  method: "DELETE",
  path: "/api/v1/projects/:project/members/:user",
  route: (request) => ({ operation: "projectMembers.remove", payload: { user: request.params.user }, projectId: request.params.project }),
});
