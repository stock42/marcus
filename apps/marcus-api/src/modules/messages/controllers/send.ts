import { apiController } from "@/http/controller";

export default apiController({
  name: "messages.send",
  method: "POST",
  path: "/api/v1/projects/:project/messages",
  route: (request) => ({ operation: "messages.send", payload: request.body, projectId: request.params.project, status: 201 }),
});
