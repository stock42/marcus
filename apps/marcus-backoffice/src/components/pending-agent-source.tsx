"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileClock, FileEdit, LoaderCircle, Rocket } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requestBff } from "@/lib/marcus/client";

type Props = {
  projectId: string;
  agent: string;
  sourceHref: string;
};

export function PendingAgentSource({ projectId, agent, sourceHref }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    try {
      await requestBff(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/apply`, { method: "POST" });
      toast.success("La edición fue validada y activada como nueva versión");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo validar y activar la edición.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-agent-pending-source className="border-amber-400/35 bg-amber-400/[0.06] ring-amber-400/15">
      <CardContent className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300"><FileClock className="size-5" /></div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-heading text-base font-medium">Cambios guardados pendientes</h2><Badge variant="outline" className="border-amber-400/35 text-amber-200">Borrador</Badge></div>
            <p className="max-w-3xl text-sm text-muted-foreground">El Markdown editado está guardado, pero la versión activa todavía no cambió. Validalo para crear una versión inmutable y comenzar a usarla.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline"><Link href={sourceHref}><FileEdit />Revisar fuente</Link></Button>
          <AlertDialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
            <AlertDialogTrigger asChild><Button><Rocket />Usar esta edición</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Rocket /></div>
                <AlertDialogTitle>¿Usar esta edición como nueva versión activa?</AlertDialogTitle>
                <AlertDialogDescription>Marcus validará y compilará el Markdown, registrará una versión inmutable y la activará. Si la validación falla, la versión actual seguirá en uso.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={(event) => {
                    event.preventDefault();
                    void apply();
                  }}
                >
                  {busy && <LoaderCircle className="animate-spin" />}{busy ? "Validando…" : "Validar y activar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
