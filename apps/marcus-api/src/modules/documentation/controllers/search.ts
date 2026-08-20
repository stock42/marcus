import { apiController, queryValue } from "@/http/controller";

export default apiController({
  name: "documentation.search",
  method: "GET",
  path: "/api/v1/documentation/search",
  route: (request) => ({ operation: "documentation.search", payload: { query: queryValue(request.query.q) ?? "", ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }) } }),
});
