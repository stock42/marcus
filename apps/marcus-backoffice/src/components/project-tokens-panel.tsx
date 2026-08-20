"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clipboard, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestBff } from "@/lib/marcus/client";
import type { CreatedProjectAccessToken, ProjectAccessToken } from "@/lib/marcus/types";

export function ProjectTokensPanel({ projectId, tokens, apiAgents, canManage }: { projectId: string; tokens: ProjectAccessToken[]; apiAgents: string[]; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedProjectAccessToken>();

  async function createToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const expires = String(data.get("expiresAt") ?? "");
    setBusy(true);
    try {
      const result = await requestBff<CreatedProjectAccessToken>(`/api/projects/${encodeURIComponent(projectId)}/tokens`, {
        method: "POST",
        body: JSON.stringify({ label: String(data.get("label") ?? ""), ...(expires === "" ? {} : { expiresAt: new Date(expires).toISOString() }) }),
      });
      setCreated(result);
      form.reset();
      router.refresh();
      toast.success("Token de API creado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
    setBusy(true);
    try {
      await requestBff(`/api/projects/${encodeURIComponent(projectId)}/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" });
      router.refresh();
      toast.success("Token revocado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo revocar el token.");
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
    <section className="space-y-4" aria-labelledby="tokens-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow">API credentials</p><h2 id="tokens-title" className="text-xl font-semibold">Tokens</h2><p className="mt-1 text-sm text-muted-foreground">Credenciales limitadas a este Project para invocar agentes con API habilitada.</p></div>
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogTrigger asChild><Button disabled={!canManage || apiAgents.length === 0}><Plus />Crear token</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Crear token del Project</DialogTitle><DialogDescription>El token permitirá invocar los agentes API de este Project. El valor secreto se muestra una sola vez.</DialogDescription></DialogHeader>
            {created === undefined ? (
              <form onSubmit={createToken} className="space-y-5">
                <Field><FieldLabel htmlFor="token-label">Nombre</FieldLabel><Input id="token-label" name="label" required minLength={2} maxLength={80} placeholder="Integración producción" /><FieldDescription>Usá un nombre que identifique el sistema consumidor.</FieldDescription></Field>
                <Field><FieldLabel htmlFor="token-expiry">Expiración opcional</FieldLabel><Input id="token-expiry" name="expiresAt" type="datetime-local" /></Field>
                <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Crear token</Button></DialogFooter>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4"><strong className="text-sm text-amber-200">Copialo ahora</strong><p className="mt-1 text-xs text-muted-foreground">Marcus no puede volver a mostrar este secreto.</p><code className="mt-3 block break-all rounded-md bg-background p-3 text-xs" data-project-token-secret>{created.token}</code></div>
                <DialogFooter><Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(created.token).then(() => toast.success("Token copiado"))}><Clipboard />Copiar</Button><Button type="button" onClick={() => changeOpen(false)}><Check />Listo</Button></DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {apiAgents.length === 0 && <Card className="border-amber-500/20 bg-amber-500/5"><CardHeader><CardTitle className="text-base">Primero habilitá el acceso API</CardTitle><CardDescription>Entrá al detalle de un agente Markdown y activá “Acceso por API”.</CardDescription></CardHeader></Card>}
      {apiAgents.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Agentes con API habilitada"><span className="text-sm text-muted-foreground">Disponibles:</span>{apiAgents.map((agent) => <Badge key={agent} variant="outline"><ShieldCheck />{agent}</Badge>)}</div>}

      <Card className="border-border/75 bg-card/55"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Token ID</TableHead><TableHead>Estado</TableHead><TableHead>Último uso</TableHead><TableHead>Creado</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>
        {tokens.map((token) => <TableRow key={token.tokenId}><TableCell className="font-medium">{token.label}</TableCell><TableCell className="font-mono text-xs">{token.tokenId}</TableCell><TableCell><Badge variant={token.status === "active" ? "default" : "outline"}>{token.status}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(token.lastUsedAt)}</TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(token.createdAt)}</TableCell><TableCell className="text-right"><Button type="button" variant="ghost" size="sm" disabled={!canManage || busy || token.status !== "active"} onClick={() => void revoke(token.tokenId)}><Trash2 />Revocar</Button></TableCell></TableRow>)}
        {tokens.length === 0 && <TableRow><TableCell colSpan={6} className="h-36 text-center text-muted-foreground">Todavía no hay tokens para este Project.</TableCell></TableRow>}
      </TableBody></Table></CardContent></Card>
    </section>
  );
}

function formatDate(value: string | undefined): string {
  if (value === undefined) return "Nunca";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
