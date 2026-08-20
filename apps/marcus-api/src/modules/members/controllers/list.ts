import { apiController } from "@/http/controller";

export default apiController({
  name: "members.list",
  method: "GET",
  path: "/api/v1/projects/:project/members",
  route: (request) => ({ operation: "projectMembers.list", payload: {}, projectId: request.params.project }),
});
