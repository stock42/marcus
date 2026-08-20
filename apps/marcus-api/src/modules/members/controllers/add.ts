import { apiController } from "@/http/controller";

export default apiController({
  name: "members.add",
  method: "POST",
  path: "/api/v1/projects/:project/members",
  route: (request) => ({ operation: "projectMembers.add", payload: request.body, projectId: request.params.project, status: 201 }),
});
