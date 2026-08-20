import { apiController } from "@/http/controller";

export default apiController({
  name: "members.create",
  method: "POST",
  path: "/api/v1/projects/:project/members/users",
  route: (request) => ({ operation: "projectMembers.create", payload: request.body, projectId: request.params.project, status: 201 }),
});
