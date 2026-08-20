import { apiController } from "@/http/controller";

export default apiController({
  name: "schedules.trigger",
  method: "POST",
  path: "/api/v1/projects/:project/schedules/:schedule/trigger",
  route: (request) => ({ operation: "schedules.trigger", payload: { ...request.body, scheduleId: request.params.schedule }, projectId: request.params.project }),
});
