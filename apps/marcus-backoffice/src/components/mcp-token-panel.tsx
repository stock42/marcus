"use client";

import { useState, type FormEvent } from "react";
import { Check, Clipboard, KeyRound, LoaderCircle, Network, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestBff } from "@/lib/marcus/client";
import type { CreatedMcpAccessToken, McpAccessToken } from "@/lib/marcus/types";

export function McpTokenPanel({ tokens, endpoint }: { tokens: McpAccessToken[]; endpoint: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedMcpAccessToken>();

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const expires = String(data.get("expiresAt") ?? "");
    setBusy(true);
    try {
      const result = await requestBff<CreatedMcpAccessToken>("/api/mcp/tokens", {
        method: "POST",
        body: JSON.stringify({ label: String(data.get("label") ?? ""), ...(expires === "" ? {} : { expiresAt: new Date(expires).toISOString() }) }),
      });
      setCreated(result);
      form.reset();
      router.refresh();
      toast.success("Token MCP global creado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el token MCP.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
    setBusy(true);
    try {
      await requestBff(`/api/mcp/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" });
      router.refresh();
      toast.success("Token MCP revocado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo revocar el token MCP.");
    } finally {
      setBusy(false);
    }
  }

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) setCreated(undefined);
  }

  return (
    <section className="space-y-4" aria-labelledby="mcp-tokens-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow">Developer access</p><h2 id="mcp-tokens-title" className="text-xl font-semibold">Model Context Protocol</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Conectá Codex o Claude a Marcus para investigar, planificar, escribir, compilar y operar agentes con la autoridad auditada del administrador.</p></div>
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogTrigger asChild><Button><Plus />Crear token MCP</Button></DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Network /></div><DialogTitle>Crear acceso MCP global</DialogTitle><DialogDescription>El token hereda autoridad administrativa global, se valida en cada request y puede revocarse inmediatamente. El secreto se muestra una sola vez.</DialogDescription></DialogHeader>
            {created === undefined ? (
              <form onSubmit={createToken} className="space-y-5">
                <Field><FieldLabel htmlFor="mcp-token-label">Nombre</FieldLabel><Input id="mcp-token-label" name="label" required minLength={2} maxLength={80} placeholder="Codex workstation" /><FieldDescription>Identificá la máquina o integración que lo utilizará.</FieldDescription></Field>
                <Field><FieldLabel htmlFor="mcp-token-expiry">Expiración opcional</FieldLabel><Input id="mcp-token-expiry" name="expiresAt" type="datetime-local" /></Field>
                <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Crear token</Button></DialogFooter>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4"><strong className="text-sm text-amber-200">Copialo ahora</strong><p className="mt-1 text-xs text-muted-foreground">Marcus almacena únicamente el hash y no puede mostrar este valor nuevamente.</p><code className="mt-3 block break-all rounded-md bg-background p-3 text-xs" data-mcp-token-secret>{created.token}</code></div>
                <DialogFooter><Button type="button" variant="outline" onClick={() => void copy(created.token, "Token copiado")}><Clipboard />Copiar token</Button><Button type="button" onClick={() => changeOpen(false)}><Check />Listo</Button></DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-primary/20 bg-primary/[0.035]">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-primary" />Conexión</CardTitle><CardDescription>Endpoint Streamable HTTP: <code>{endpoint}</code></CardDescription></CardHeader>
        <CardContent>
          <Tabs defaultValue="codex">
            <TabsList><TabsTrigger value="codex">Codex</TabsTrigger><TabsTrigger value="claude">Claude Code</TabsTrigger></TabsList>
            <TabsContent value="codex" className="space-y-3 pt-3"><p className="text-sm text-muted-foreground">Guardá el secreto en <code>MARCUS_MCP_TOKEN</code> y agregá este bloque a <code>~/.codex/config.toml</code>:</p><Snippet text={`[mcp_servers.marcus]\nurl = "${endpoint}"\nbearer_token_env_var = "MARCUS_MCP_TOKEN"`} /></TabsContent>
            <TabsContent value="claude" className="space-y-3 pt-3"><p className="text-sm text-muted-foreground">Exportá <code>MARCUS_MCP_TOKEN</code> y registrá el servidor HTTP:</p><Snippet text={`claude mcp add --transport http marcus ${endpoint} \\\n  --header "Authorization: Bearer $MARCUS_MCP_TOKEN"`} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-border/75 bg-card/55"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Token ID</TableHead><TableHead>Estado</TableHead><TableHead>Último uso</TableHead><TableHead>Creado</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>
        {tokens.map((token) => <TableRow key={token.tokenId}><TableCell className="font-medium">{token.label}</TableCell><TableCell className="font-mono text-xs">{token.tokenId}</TableCell><TableCell><Badge variant={token.status === "active" ? "default" : "outline"}>{token.status}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(token.lastUsedAt)}</TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(token.createdAt)}</TableCell><TableCell className="text-right"><Button type="button" variant="ghost" size="sm" disabled={busy || token.status !== "active"} onClick={() => void revoke(token.tokenId)}><Trash2 />Revocar</Button></TableCell></TableRow>)}
        {tokens.length === 0 && <TableRow><TableCell colSpan={6} className="h-36 text-center text-muted-foreground">Todavía no hay accesos MCP globales.</TableCell></TableRow>}
      </TableBody></Table></CardContent></Card>
    </section>
  );
}

function Snippet({ text }: { text: string }) {
  return <div className="relative"><pre className="overflow-x-auto rounded-lg border border-border/70 bg-background/70 p-4 pr-12 text-xs leading-relaxed"><code>{text}</code></pre><Button type="button" variant="ghost" size="icon-sm" className="absolute right-2 top-2" aria-label="Copiar configuración" onClick={() => void copy(text, "Configuración copiada")}><Clipboard /></Button></div>;
}

async function copy(value: string, message: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast.success(message);
}

function formatDate(value: string | undefined): string {
  if (value === undefined) return "Nunca";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
