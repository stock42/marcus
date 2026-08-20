import { apiController, queryValue } from "@/http/controller";

export default apiController({
  name: "tools.list",
  method: "GET",
  path: "/api/v1/projects/:project/tools",
  route: (request) => ({
    operation: "tools.list",
    payload: {
      ...(queryValue(request.query.agent) === undefined ? {} : { agent: queryValue(request.query.agent)! }),
      ...(queryValue(request.query.agentVersionId) === undefined ? {} : { agentVersionId: queryValue(request.query.agentVersionId)! }),
    },
    projectId: request.params.project,
  }),
});
