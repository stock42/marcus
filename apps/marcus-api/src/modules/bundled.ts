import { Controller, type ControllerType } from "s42-core";
import definition1 from "./members/controllers/list.ts";
import definition2 from "./members/controllers/add.ts";
import definition3 from "./members/controllers/remove.ts";
import definition4 from "./secrets/controllers/show.ts";
import definition5 from "./secrets/controllers/list.ts";
import definition6 from "./secrets/controllers/revoke.ts";
import definition7 from "./secrets/controllers/set.ts";
import definition8 from "./validators/controllers/get.ts";
import definition9 from "./validators/controllers/build.ts";
import definition10 from "./validators/controllers/list.ts";
import definition11 from "./validators/controllers/versions.ts";
import definition12 from "./validators/controllers/disable.ts";
import definition13 from "./validators/controllers/activate.ts";
import definition14 from "./validators/controllers/test.ts";
import definition15 from "./runs/controllers/get.ts";
import definition16 from "./runs/controllers/list.ts";
import definition17 from "./runs/controllers/attach.ts";
import definition18 from "./runs/controllers/cancel.ts";
import definition19 from "./agents/controllers/get.ts";
import definition20 from "./agents/controllers/asset.ts";
import definition21 from "./agents/controllers/contract.ts";
import definition22 from "./agents/controllers/build.ts";
import definition23 from "./agents/controllers/list.ts";
import definition24 from "./agents/controllers/versions.ts";
import definition25 from "./agents/controllers/instances.ts";
import definition26 from "./agents/controllers/diff.ts";
import definition27 from "./agents/controllers/apply.ts";
import definition28 from "./agents/controllers/start.ts";
import definition29 from "./agents/controllers/stop.ts";
import definition30 from "./agents/controllers/restart.ts";
import definition31 from "./agents/controllers/invoke.ts";
import definition32 from "./events/controllers/publish.ts";
import definition33 from "./events/controllers/list.ts";
import definition34 from "./approvals/controllers/decision.ts";
import definition35 from "./approvals/controllers/list.ts";
import definition36 from "./artifacts/controllers/get.ts";
import definition37 from "./artifacts/controllers/list.ts";
import definition38 from "./schedules/controllers/list.ts";
import definition39 from "./schedules/controllers/trigger.ts";
import definition40 from "./audit/controllers/list.ts";
import definition41 from "./processes/controllers/get.ts";
import definition42 from "./processes/controllers/kill.ts";
import definition43 from "./processes/controllers/list.ts";
import definition44 from "./processes/controllers/attach.ts";
import definition45 from "./documentation/controllers/openapi.ts";
import definition46 from "./documentation/controllers/docs.ts";
import definition47 from "./health/controllers/live.ts";
import definition48 from "./health/controllers/ready.ts";
import definition49 from "./auth/controllers/logout.ts";
import definition50 from "./auth/controllers/login.ts";
import definition95 from "./auth/controllers/session.ts";
import definition51 from "./uploads/controllers/open.ts";
import definition52 from "./uploads/controllers/chunk.ts";
import definition53 from "./uploads/controllers/commit.ts";
import definition54 from "./uploads/controllers/abort.ts";
import definition55 from "./uploads/controllers/resume.ts";
import definition56 from "./users/controllers/list.ts";
import definition57 from "./users/controllers/disable.ts";
import definition58 from "./users/controllers/create.ts";
import definition59 from "./conversations/controllers/get.ts";
import definition60 from "./conversations/controllers/clear.ts";
import definition61 from "./conversations/controllers/list.ts";
import definition62 from "./conversations/controllers/messages.ts";
import definition63 from "./messages/controllers/ack.ts";
import definition64 from "./messages/controllers/list.ts";
import definition65 from "./messages/controllers/send.ts";
import definition66 from "./backups/controllers/verify.ts";
import definition67 from "./backups/controllers/list.ts";
import definition68 from "./backups/controllers/create.ts";
import definition69 from "./projects/controllers/get.ts";
import definition70 from "./projects/controllers/list.ts";
import definition71 from "./projects/controllers/create.ts";
import definition72 from "./logs/controllers/list.ts";
import definition73 from "./providers/controllers/list.ts";
import definition74 from "./providers/controllers/models.ts";
import definition75 from "./providers/controllers/test.ts";
import definition76 from "./providers/controllers/create.ts";
import definition77 from "./files/controllers/trash.ts";
import definition78 from "./files/controllers/sync-open.ts";
import definition79 from "./files/controllers/mkdir.ts";
import definition80 from "./files/controllers/watch.ts";
import definition81 from "./files/controllers/write.ts";
import definition82 from "./files/controllers/stat.ts";
import definition83 from "./files/controllers/list.ts";
import definition84 from "./files/controllers/read.ts";
import definition85 from "./files/controllers/restore.ts";
import definition86 from "./files/controllers/move.ts";
import definition87 from "./files/controllers/copy.ts";
import definition88 from "./files/controllers/search.ts";
import definition89 from "./model-roles/controllers/list.ts";
import definition90 from "./model-roles/controllers/set.ts";
import definition91 from "./model-roles/controllers/delete.ts";
import definition92 from "./tokens/controllers/list.ts";
import definition93 from "./tokens/controllers/revoke.ts";
import definition94 from "./tokens/controllers/create.ts";
import definition96 from "./projects/controllers/delete.ts";
import definition97 from "./agents/controllers/generate.ts";
import definition98 from "./assistant/controllers/chat.ts";
import definition99 from "./configuration/controllers/get-default-llm.ts";
import definition100 from "./configuration/controllers/set-default-llm.ts";
import definition101 from "./providers/controllers/catalog.ts";
import definition102 from "./agents/controllers/generation-progress.ts";
import definition103 from "./users/controllers/change-password.ts";
import definition104 from "./members/controllers/create.ts";
import definition105 from "./members/controllers/update.ts";
import definition106 from "./projects/controllers/dashboard.ts";
import definition107 from "./projects/controllers/tokens-list.ts";
import definition108 from "./projects/controllers/tokens-create.ts";
import definition109 from "./projects/controllers/tokens-revoke.ts";
import definition110 from "./agents/controllers/api-access.ts";
import definition111 from "./agents/controllers/input-example.ts";
import definition112 from "./agents/controllers/compiled.ts";
import definition113 from "./system/controllers/overview.ts";
import definition114 from "./system/controllers/logs.ts";
import definition115 from "./system/controllers/search.ts";
import definition116 from "./mcp-tokens/controllers/list.ts";
import definition117 from "./mcp-tokens/controllers/create.ts";
import definition118 from "./mcp-tokens/controllers/revoke.ts";
import definition119 from "./agents/controllers/plan.ts";
import definition120 from "./documentation/controllers/list.ts";
import definition121 from "./documentation/controllers/search.ts";
import definition122 from "./documentation/controllers/read.ts";
import definition123 from "./mcp/controllers/post.ts";
import definition124 from "./mcp/controllers/get.ts";
import definition125 from "./mcp/controllers/delete.ts";
import definition126 from "./tools/controllers/list.ts";

const definitions: readonly ControllerType[] = [
  definition1,
  definition2,
  definition3,
  definition4,
  definition5,
  definition6,
  definition7,
  definition8,
  definition9,
  definition10,
  definition11,
  definition12,
  definition13,
  definition14,
  definition15,
  definition16,
  definition17,
  definition18,
  definition19,
  definition20,
  definition21,
  definition22,
  definition23,
  definition24,
  definition25,
  definition26,
  definition27,
  definition28,
  definition29,
  definition30,
  definition31,
  definition32,
  definition33,
  definition34,
  definition35,
  definition36,
  definition37,
  definition38,
  definition39,
  definition40,
  definition41,
  definition42,
  definition43,
  definition44,
  definition45,
  definition46,
  definition47,
  definition48,
  definition49,
  definition50,
  definition51,
  definition52,
  definition53,
  definition54,
  definition55,
  definition56,
  definition57,
  definition58,
  definition59,
  definition60,
  definition61,
  definition62,
  definition63,
  definition64,
  definition65,
  definition66,
  definition67,
  definition68,
  definition69,
  definition70,
  definition71,
  definition72,
  definition73,
  definition74,
  definition75,
  definition76,
  definition77,
  definition78,
  definition79,
  definition80,
  definition81,
  definition82,
  definition83,
  definition84,
  definition85,
  definition86,
  definition87,
  definition88,
  definition89,
  definition90,
  definition91,
  definition92,
  definition93,
  definition94,
  definition95,
  definition96,
  definition97,
  definition98,
  definition99,
  definition100,
  definition101,
  definition102,
  definition103,
  definition104,
  definition105,
  definition106,
  definition107,
  definition108,
  definition109,
  definition110,
  definition111,
  definition112,
  definition113,
  definition114,
  definition115,
  definition116,
  definition117,
  definition118,
  definition119,
  definition120,
  definition121,
  definition122,
  definition123,
  definition124,
  definition125,
  definition126,
];

export function createBundledModuleControllers(): Controller[] {
  return definitions.map((definition) => new Controller(
    definition.method,
    definition.path,
    (request, response) => definition.handler(request, response, { events: { emit() {} } }),
  ));
}
