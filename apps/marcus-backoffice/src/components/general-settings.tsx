"use client";

import { useState, type FormEvent } from "react";
import { Check, KeyRound, LoaderCircle, Network, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { McpTokenPanel } from "@/components/mcp-token-panel";
import { requestBff } from "@/lib/marcus/client";
import { PASSWORD_POLICY_MESSAGE } from "@/lib/marcus/validation";
import type { McpAccessToken, User } from "@/lib/marcus/types";

export function GeneralSettings({ administrators, currentUsername, tokens, endpoint }: { administrators: User[]; currentUsername?: string; tokens: McpAccessToken[]; endpoint: string }) {
  return (
    <Tabs defaultValue="administrators" className="gap-6">
      <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto border-b border-border/70 pb-1" aria-label="Configuración general">
        <TabsTrigger value="administrators" className="px-4 py-2"><Users />Administradores <Badge variant="outline">{administrators.length}</Badge></TabsTrigger>
        <TabsTrigger value="password" className="px-4 py-2"><KeyRound />Mi contraseña</TabsTrigger>
        <TabsTrigger value="mcp" className="px-4 py-2"><Network />Acceso MCP <Badge variant="outline">{tokens.filter((token) => token.status === "active").length}</Badge></TabsTrigger>
      </TabsList>
      <TabsContent value="administrators"><AdministratorsCard administrators={administrators} currentUsername={currentUsername} /></TabsContent>
      <TabsContent value="password" className="max-w-2xl"><ChangePasswordCard /></TabsContent>
      <TabsContent value="mcp"><McpTokenPanel tokens={tokens} endpoint={endpoint} /></TabsContent>
    </Tabs>
  );
}

function AdministratorsCard({ administrators, currentUsername }: { administrators: User[]; currentUsername?: string }) {
  return (
    <Card className="border-border/75 bg-card/55">
      <CardHeader className="flex flex-col gap-4 border-b border-border/60 sm:flex-row sm:items-center sm:justify-between">
        <div><CardTitle>Administradores</CardTitle><CardDescription>Identidades con autoridad global sobre Marcus.</CardDescription></div>
        <CreateAdministratorDialog />
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Usuario</TableHead><TableHead>Estado</TableHead><TableHead className="hidden sm:table-cell">Creado</TableHead></TableRow></TableHeader>
          <TableBody>{administrators.map((administrator) => (
            <TableRow key={administrator.userId}>
              <TableCell><div className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="size-4" /></span><div><strong className="block text-sm">{administrator.username}</strong>{administrator.username === currentUsername && <span className="text-xs text-muted-foreground">Sesión actual</span>}</div></div></TableCell>
              <TableCell><Badge variant={administrator.status === "active" ? "outline" : "secondary"}>{administrator.status === "active" ? "Activo" : "Deshabilitado"}</Badge></TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{formatDate(administrator.createdAt)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
        {administrators.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No se encontraron administradores.</p>}
      </CardContent>
    </Card>
  );
}

function CreateAdministratorDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestBff("/api/users", { method: "POST", body: JSON.stringify({ username: data.get("username"), password }) });
      toast.success("Administrador creado");
      form.reset();
      setOpen(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo crear el administrador.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><UserPlus />Nuevo administrador</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldCheck /></div><DialogTitle>Crear administrador</DialogTitle><DialogDescription>La nueva identidad tendrá autoridad global sobre proyectos, usuarios y configuración.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <FieldGroup>
            <Field><FieldLabel htmlFor="admin-username">Usuario</FieldLabel><Input id="admin-username" name="username" minLength={3} maxLength={64} autoComplete="username" required autoFocus /><FieldDescription>Letras, números, punto, guion o guion bajo.</FieldDescription></Field>
            <Field><FieldLabel htmlFor="admin-password">Contraseña</FieldLabel><Input id="admin-password" name="password" type="password" minLength={6} maxLength={1024} autoComplete="new-password" aria-describedby="admin-password-policy" required /></Field>
            <Field><FieldLabel htmlFor="admin-confirmation">Confirmar contraseña</FieldLabel><Input id="admin-confirmation" name="confirmation" type="password" minLength={6} maxLength={1024} autoComplete="new-password" required /></Field>
          </FieldGroup>
          <PasswordPolicy id="admin-password-policy" />
          <p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Crear administrador</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestBff("/api/users/me/password", { method: "PATCH", body: JSON.stringify({ currentPassword: data.get("currentPassword"), password }) });
      form.reset();
      toast.success("Contraseña actualizada");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cambiar la contraseña.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/20 bg-primary/[0.035]">
      <CardHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound /></div><CardTitle>Tu contraseña</CardTitle><CardDescription>Confirmá la credencial actual antes de reemplazarla.</CardDescription></CardHeader>
      <CardContent><form onSubmit={submit} className="space-y-5">
        <FieldGroup>
          <Field><FieldLabel htmlFor="current-password">Contraseña actual</FieldLabel><Input id="current-password" name="currentPassword" type="password" maxLength={1024} autoComplete="current-password" required /></Field>
          <Field><FieldLabel htmlFor="new-password">Nueva contraseña</FieldLabel><Input id="new-password" name="password" type="password" minLength={6} maxLength={1024} autoComplete="new-password" aria-describedby="new-password-policy" required /></Field>
          <Field><FieldLabel htmlFor="password-confirmation">Confirmar contraseña</FieldLabel><Input id="password-confirmation" name="confirmation" type="password" minLength={6} maxLength={1024} autoComplete="new-password" required /></Field>
        </FieldGroup>
        <PasswordPolicy id="new-password-policy" />
        <p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>
        <Button type="submit" className="w-full" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Cambiar contraseña</Button>
      </form></CardContent>
    </Card>
  );
}

function PasswordPolicy({ id }: { id: string }) {
  return <div id={id} className="rounded-lg border border-border/70 bg-background/35 p-3 text-xs leading-relaxed text-muted-foreground"><span className="flex items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-primary" />{PASSWORD_POLICY_MESSAGE}</span></div>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(value));
}
