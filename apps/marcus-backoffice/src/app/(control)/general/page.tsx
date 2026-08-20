import type { Metadata } from "next";
import { Network, ShieldCheck, Users } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { GeneralSettings } from "@/components/general-settings";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { marcusApiUrl } from "@/lib/marcus/origin";
import { getMarcusSession, requestMarcus } from "@/lib/marcus/server";
import type { McpAccessToken, User } from "@/lib/marcus/types";

export const metadata: Metadata = { title: "Configuración general" };

export default async function GeneralPage() {
  const [usersResult, tokensResult, session] = await Promise.all([
    requestMarcus<User[]>("/api/v1/users"),
    requestMarcus<McpAccessToken[]>("/api/v1/mcp/tokens"),
    getMarcusSession(),
  ]);
  if (!usersResult.envelope.ok) return <ApiErrorPanel code={usersResult.envelope.error.code} message={usersResult.envelope.error.message} />;
  const administrators = usersResult.envelope.data.filter((user) => user.roles.includes("system_admin"));
  const tokens = tokensResult.envelope.ok ? tokensResult.envelope.data : [];
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8">
      <section className="page-heading"><div><p className="eyebrow">Configuración · General</p><h1>Acceso administrativo</h1><p>Gestioná las identidades con autoridad global y protegé tu propia credencial.</p></div></section>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Resumen de seguridad">
        <Metric icon={Users} label="Administradores" value={administrators.length} detail="Con autoridad global" />
        <Metric icon={ShieldCheck} label="Política" value="Activa" detail="Validada por marcusd" />
        <Metric icon={Network} label="MCP" value={tokens.filter((token) => token.status === "active").length} detail="Accesos globales activos" />
      </section>
      {!tokensResult.envelope.ok && <ApiErrorPanel code={tokensResult.envelope.error.code} message={tokensResult.envelope.error.message} />}
      <GeneralSettings administrators={administrators} currentUsername={session.principal?.username} tokens={tokens} endpoint={marcusApiUrl("/mcp").toString()} />
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Users; label: string; value: string | number; detail: string }) {
  return <Card size="sm" className="border-border/70 bg-card/45"><CardHeader><CardDescription>{label}</CardDescription><Icon className="size-4 text-primary" /></CardHeader><CardContent><strong className="text-2xl font-semibold">{value}</strong><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}
