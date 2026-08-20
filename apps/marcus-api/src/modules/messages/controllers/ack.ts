import { apiController } from "@/http/controller";

export default apiController({
  name: "messages.ack",
  method: "POST",
  path: "/api/v1/projects/:project/messages/:message/ack",
  route: (request) => ({ operation: "messages.ack", payload: { messageId: request.params.message }, projectId: request.params.project }),
});
