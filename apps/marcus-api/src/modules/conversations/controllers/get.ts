import { apiController } from "@/http/controller";

export default apiController({
  name: "conversations.get",
  method: "GET",
  path: "/api/v1/projects/:project/conversations/:conversation",
  route: (request) => ({ operation: "conversations.get", payload: { conversationId: request.params.conversation }, projectId: request.params.project }),
});
