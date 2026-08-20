"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestBff } from "@/lib/marcus/client";
import { PASSWORD_POLICY_MESSAGE, type ProjectRole } from "@/lib/marcus/validation";
import type { ProjectMember } from "@/lib/marcus/types";

const roles: Array<{ value: ProjectRole; label: string; description: string }> = [
  { value: "project_owner", label: "Owner", description: "Administra el Project, sus usuarios y operación." },
  { value: "project_operator", label: "Operator", description: "Ejecuta agentes y administra Runs." },
  { value: "project_developer", label: "Developer", description: "Edita archivos, crea agentes y ejecuta Runs." },
  { value: "project_viewer", label: "Viewer", description: "Acceso de solo lectura." },
];

export function ProjectMembersPanel({ projectId, members, canManage }: { projectId: string; members: ProjectMember[]; canManage: boolean }) {
  return (
    <section className="space-y-4" aria-labelledby="project-users-title">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Control de acceso</p><h2 id="project-users-title" className="text-xl font-semibold">Usuarios</h2><p className="mt-1 text-sm text-muted-foreground">Credenciales individuales y roles aplicados por marcusd.</p></div>{canManage && <CreateProjectMemberDialog projectId={projectId} />}</div>
      <Card className="border-border/75 bg-card/55">
        <CardHeader className="border-b border-border/60"><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4 text-primary" />Acceso al Project</CardTitle><CardDescription>{members.length} {members.length === 1 ? "identidad autorizada" : "identidades autorizadas"}</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Usuario</TableHead><TableHead>Rol</TableHead><TableHead className="hidden md:table-cell">Estado</TableHead><TableHead className="w-32 text-right">Acciones</TableHead></TableRow></TableHeader>
            <TableBody>{members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell><div><strong className="block text-sm">{member.username}</strong><span className="font-mono text-[10px] text-muted-foreground">{member.userId}</span></div></TableCell>
                <TableCell><Badge variant="outline">{roleLabel(member.role)}</Badge></TableCell>
                <TableCell className="hidden md:table-cell"><span className="inline-flex items-center gap-2 text-xs"><i className={`size-1.5 rounded-full ${member.status === "active" ? "bg-primary" : "bg-muted-foreground"}`} />{member.status === "active" ? "Activo" : "Deshabilitado"}</span></TableCell>
                <TableCell><div className="flex justify-end gap-1">{canManage ? <><EditProjectMemberDialog projectId={projectId} member={member} /><RemoveProjectMemberButton projectId={projectId} member={member} /></> : <span className="px-2 text-xs text-muted-foreground">Sólo lectura</span>}</div></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
          {members.length === 0 && <div className="grid min-h-48 place-items-center p-8 text-center"><div><Users className="mx-auto mb-3 size-7 text-primary" /><p className="font-medium">Sin usuarios asignados</p><p className="mt-1 text-sm text-muted-foreground">Creá la primera credencial para este Project.</p></div></div>}
        </CardContent>
      </Card>
    </section>
  );
}

function CreateProjectMemberDialog({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true); setError("");
    try {
      await requestBff(`/api/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", body: JSON.stringify({ username: data.get("username"), password, role: data.get("role") }) });
      toast.success("Usuario creado y asignado al Project");
      form.reset(); setOpen(false); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear el usuario."); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><UserPlus />Nuevo usuario</Button></DialogTrigger><DialogContent className="sm:max-w-lg"><DialogHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserPlus /></div><DialogTitle>Crear usuario del Project</DialogTitle><DialogDescription>Marcus crea una credencial individual y limita su acceso al rol seleccionado.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><MemberFields idPrefix="create-member" /><FieldGroup><Field><FieldLabel htmlFor="create-member-password">Contraseña</FieldLabel><Input id="create-member-password" name="password" type="password" minLength={6} maxLength={1024} autoComplete="new-password" aria-describedby="create-member-policy" required /></Field><Field><FieldLabel htmlFor="create-member-confirmation">Confirmar contraseña</FieldLabel><Input id="create-member-confirmation" name="confirmation" type="password" minLength={6} maxLength={1024} autoComplete="new-password" required /></Field></FieldGroup><PasswordPolicy id="create-member-policy" /><p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Crear usuario</Button></DialogFooter></form></DialogContent></Dialog>;
}

function EditProjectMemberDialog({ projectId, member }: { projectId: string; member: ProjectMember }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true); setError("");
    try {
      await requestBff(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(member.userId)}`, { method: "PUT", body: JSON.stringify({ username: data.get("username"), role: data.get("role"), ...(password === "" ? {} : { password }) }) });
      toast.success("Usuario actualizado"); setOpen(false); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo actualizar el usuario."); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Editar ${member.username}`}><Pencil /></Button></DialogTrigger><DialogContent className="sm:max-w-lg"><DialogHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Pencil /></div><DialogTitle>Editar {member.username}</DialogTitle><DialogDescription>Cambiá su identidad, rol o contraseña dentro de este Project.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><MemberFields idPrefix="edit-member" member={member} /><FieldGroup><Field><FieldLabel htmlFor="edit-member-password">Nueva contraseña</FieldLabel><Input id="edit-member-password" name="password" type="password" minLength={6} maxLength={1024} autoComplete="new-password" aria-describedby="edit-member-policy" /><FieldDescription>Dejala vacía para conservar la actual.</FieldDescription></Field><Field><FieldLabel htmlFor="edit-member-confirmation">Confirmar contraseña</FieldLabel><Input id="edit-member-confirmation" name="confirmation" type="password" minLength={6} maxLength={1024} autoComplete="new-password" /></Field></FieldGroup><PasswordPolicy id="edit-member-policy" /><p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Guardar cambios</Button></DialogFooter></form></DialogContent></Dialog>;
}

function RemoveProjectMemberButton({ projectId, member }: { projectId: string; member: ProjectMember }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try { await requestBff(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" }); toast.success(`Acceso de ${member.username} eliminado`); router.refresh(); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "No se pudo eliminar el acceso."); setBusy(false); }
  }
  return <AlertDialog><AlertDialogTrigger asChild><Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Eliminar acceso de ${member.username}`}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive"><Trash2 /></div><AlertDialogTitle>¿Eliminar el acceso de {member.username}?</AlertDialogTitle><AlertDialogDescription>La identidad dejará de ver y operar este Project. Otros accesos que pueda tener no se modifican.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void remove()} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{busy && <LoaderCircle className="animate-spin" />}Eliminar acceso</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function MemberFields({ idPrefix, member }: { idPrefix: string; member?: ProjectMember }) {
  return <FieldGroup><Field><FieldLabel htmlFor={`${idPrefix}-username`}>Usuario</FieldLabel><Input id={`${idPrefix}-username`} name="username" defaultValue={member?.username} minLength={3} maxLength={64} autoComplete="username" required autoFocus /><FieldDescription>Letras, números, punto, guion o guion bajo.</FieldDescription></Field><Field><FieldLabel htmlFor={`${idPrefix}-role`}>Rol</FieldLabel><NativeSelect id={`${idPrefix}-role`} name="role" defaultValue={member?.role ?? "project_developer"} className="w-full">{roles.map((role) => <NativeSelectOption key={role.value} value={role.value}>{role.label} · {role.description}</NativeSelectOption>)}</NativeSelect></Field></FieldGroup>;
}

function PasswordPolicy({ id }: { id: string }) {
  return <div id={id} className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/35 p-3 text-xs leading-relaxed text-muted-foreground"><KeyRound className="mt-0.5 size-3.5 shrink-0 text-primary" />{PASSWORD_POLICY_MESSAGE}</div>;
}

function roleLabel(role: ProjectMember["role"]): string {
  return roles.find((item) => item.value === role)?.label ?? role;
}
