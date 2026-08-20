import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.asset",
  method: "GET",
  path: "/api/v1/projects/:project/agents/:agent/assets/*",
  route: (request) => ({ operation: "agents.asset", payload: { agent: request.params.agent, path: request.url.split("/").filter(Boolean).slice(7).join("/") }, projectId: request.params.project, binary: true }),
});
