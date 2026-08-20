import { apiController, queryValue } from "@/http/controller";

export default apiController({
  name: "files.search",
  method: "GET",
  path: "/api/v1/projects/:project/files/search",
  route: (request) => ({ operation: "files.search", payload: { query: queryValue(request.query.q) ?? "" }, projectId: request.params.project }),
});
