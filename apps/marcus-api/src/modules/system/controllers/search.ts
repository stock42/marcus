import { apiController, queryValue } from "@/http/controller";

export default apiController({
  name: "system.search",
  method: "GET",
  path: "/api/v1/system/search",
  route: (request) => ({ operation: "system.search", payload: { query: queryValue(request.query.q) ?? "", ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }) } }),
});
