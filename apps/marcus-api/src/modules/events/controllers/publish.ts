import { apiController } from "@/http/controller";

export default apiController({
  name: "events.publish",
  method: "POST",
  path: "/api/v1/projects/:project/events",
  route: (request) => ({ operation: "events.publish", payload: request.body, projectId: request.params.project, status: 201 }),
});
