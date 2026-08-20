import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DefaultLlmGate } from "@/components/default-llm-gate";
import { getMarcusSession } from "@/lib/marcus/server";
import { requestMarcus } from "@/lib/marcus/server";
import type { DefaultLlmConfiguration, ProviderCatalogEntry } from "@/lib/marcus/types";

export const dynamic = "force-dynamic";

export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  const session = await getMarcusSession();
  if (!session.authenticated) redirect("/");
  const systemAdmin = session.principal?.roles.includes("system_admin") === true;
  if (!systemAdmin) return <AppShell systemAdmin={false} username={session.principal?.username}>{children}</AppShell>;
  const [configuration, catalogResult] = await Promise.all([
    requestMarcus<DefaultLlmConfiguration>("/api/v1/config/default-llm"),
    requestMarcus<ProviderCatalogEntry[]>("/api/v1/providers/catalog"),
  ]);
  const requiresConfiguration = configuration.envelope.ok && !configuration.envelope.data.configured;
  const catalog = catalogResult.envelope.ok ? catalogResult.envelope.data : [];
  return <AppShell systemAdmin username={session.principal?.username}>{children}<DefaultLlmGate configured={!requiresConfiguration} catalog={catalog} /></AppShell>;
}
