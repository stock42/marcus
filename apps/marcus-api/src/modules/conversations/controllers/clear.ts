import { apiController } from "@/http/controller";

export default apiController({
  name: "conversations.clear",
  method: "POST",
  path: "/api/v1/projects/:project/conversations/:conversation/clear",
  route: (request) => ({ operation: "conversations.clear", payload: { conversationId: request.params.conversation }, projectId: request.params.project }),
});
