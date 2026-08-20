import type { Metadata } from "next";
import { Boxes, BrainCircuit, Cable, ShieldCheck } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { DefaultLlmForm } from "@/components/default-llm-form";
import { ProviderTestButton } from "@/components/provider-test-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestMarcus } from "@/lib/marcus/server";
import type { DefaultLlmConfiguration, ModelRole, Provider, ProviderCatalogEntry } from "@/lib/marcus/types";

export const metadata: Metadata = { title: "Proveedores" };

export default async function ProvidersPage() {
  const [providersResult, rolesResult, defaultResult, catalogResult] = await Promise.all([
    requestMarcus<Provider[]>("/api/v1/providers"),
    requestMarcus<ModelRole[]>("/api/v1/model-roles"),
    requestMarcus<DefaultLlmConfiguration>("/api/v1/config/default-llm"),
    requestMarcus<ProviderCatalogEntry[]>("/api/v1/providers/catalog"),
  ]);
  const providers = providersResult.envelope.ok ? providersResult.envelope.data : [];
  const roles = rolesResult.envelope.ok ? rolesResult.envelope.data : [];
  const defaultLlm = defaultResult.envelope.ok && defaultResult.envelope.data.configured ? defaultResult.envelope.data : undefined;
  const catalog = catalogResult.envelope.ok ? catalogResult.envelope.data : [];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8">
      <section className="page-heading"><div><p className="eyebrow">Model control plane</p><h1>Proveedores</h1><p>Credenciales cifradas, conectividad y asignaciones globales de modelos.</p></div></section>
      {(!providersResult.envelope.ok || !rolesResult.envelope.ok || !defaultResult.envelope.ok || !catalogResult.envelope.ok) && <ApiErrorPanel code="PROVIDERS_PARTIAL" message="Parte de la configuración de modelos no pudo cargarse." />}

      <section className="grid gap-4 md:grid-cols-3" aria-label="Estado de proveedores">
        <Metric icon={Boxes} label="Proveedores" value={providers.length} detail={`${providers.filter((provider) => provider.status === "healthy").length} saludables`} />
        <Metric icon={BrainCircuit} label="LLM global" value={defaultLlm?.role.model ?? "Pendiente"} detail="Rol agent.default" />
        <Metric icon={ShieldCheck} label="Secretos" value="Cifrados" detail="Nunca se devuelven al navegador" />
      </section>

      <Tabs defaultValue="catalog" className="gap-6">
        <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto border-b border-border/70 pb-1" aria-label="Configuración de proveedores">
          <TabsTrigger value="catalog" className="px-4 py-2"><Boxes />Catálogo <Badge variant="outline">{providers.length}</Badge></TabsTrigger>
          <TabsTrigger value="default" className="px-4 py-2"><BrainCircuit />LLM predeterminado</TabsTrigger>
          <TabsTrigger value="roles" className="px-4 py-2"><Cable />Roles de modelo <Badge variant="outline">{roles.length}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value="catalog">
          <Card className="border-border/75 bg-card/55">
          <CardHeader><CardTitle>Catálogo</CardTitle><CardDescription>Proveedores OpenAI-compatible registrados en marcusd.</CardDescription></CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader><TableRow><TableHead>Proveedor</TableHead><TableHead>Endpoint</TableHead><TableHead>Estado</TableHead><TableHead>Rol global</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader>
              <TableBody>
                {providers.map((provider) => {
                  const assigned = roles.filter((role) => role.providerId === provider.providerId);
                  return <TableRow key={provider.providerId}><TableCell><strong>{provider.name}</strong><p className="font-mono text-[11px] text-muted-foreground">{provider.type}</p></TableCell><TableCell className="max-w-72 truncate font-mono text-xs">{provider.baseUrl ?? "—"}</TableCell><TableCell><ProviderStatus status={provider.status} /></TableCell><TableCell>{assigned.length === 0 ? <span className="text-muted-foreground">Sin rol</span> : assigned.map((role) => <Badge key={role.role} variant="outline" className="mr-1">{role.role}</Badge>)}</TableCell><TableCell className="text-right"><ProviderTestButton provider={provider.name} /></TableCell></TableRow>;
                })}
                {providers.length === 0 && <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Todavía no hay proveedores configurados.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="default" className="max-w-3xl">
          <Card className="border-primary/20 bg-card/70">
            <CardHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><BrainCircuit /></div><CardTitle>{defaultLlm === undefined ? "Configurar LLM global" : "Reconfigurar LLM global"}</CardTitle><CardDescription>Verifica el endpoint antes de asignar <code>agent.default</code>.</CardDescription></CardHeader>
            <CardContent><DefaultLlmForm catalog={catalog} submitLabel={defaultLlm === undefined ? "Configurar y verificar" : "Reemplazar configuración"} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-3">
          <div><p className="eyebrow">Model roles</p><h2 className="text-xl font-semibold">Asignaciones activas</h2><p className="mt-1 text-sm text-muted-foreground">Cada rol vincula una capacidad de Marcus con un proveedor y un modelo concretos.</p></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{roles.map((role) => <Card key={role.role} size="sm" className="border-border/70 bg-card/45"><CardHeader><CardTitle className="font-mono text-sm">{role.role}</CardTitle><CardAction><Badge variant="outline">{role.model}</Badge></CardAction></CardHeader><CardContent><p className="font-mono text-xs text-muted-foreground">{role.providerId}</p></CardContent></Card>)}</div>
          {roles.length === 0 && <Card className="border-dashed border-border/75 bg-card/25"><CardContent className="py-12 text-center text-sm text-muted-foreground">Todavía no hay roles de modelo asignados.</CardContent></Card>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Boxes; label: string; value: string | number; detail: string }) {
  return <Card size="sm" className="border border-border/70 bg-card/45"><CardHeader><CardDescription>{label}</CardDescription><CardAction><Icon className="size-4 text-primary" /></CardAction></CardHeader><CardContent><strong className="block truncate text-2xl font-semibold">{value}</strong><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function ProviderStatus({ status }: { status: Provider["status"] }) {
  const label = { unverified: "Sin verificar", healthy: "Saludable", degraded: "Degradado", unavailable: "No disponible" }[status];
  return <Badge variant={status === "healthy" ? "default" : status === "unavailable" ? "destructive" : "secondary"}>{label}</Badge>;
}
