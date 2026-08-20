"use client";

import { useState } from "react";
import { LoaderCircle, TriangleAlert, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { requestBff } from "@/lib/marcus/client";
import type { DeletedProject, Project } from "@/lib/marcus/types";

export function DeleteProjectButton({ project }: { project: Project }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await requestBff<DeletedProject>(`/api/projects/${encodeURIComponent(project.projectId)}`, { method: "DELETE" });
      toast.success(`${project.name} fue eliminado definitivamente`);
      router.push("/projects");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el proyecto.");
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild><Button variant="destructive"><Trash2 />Eliminar proyecto</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive"><TriangleAlert /></div>
          <AlertDialogTitle>¿Eliminar definitivamente {project.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción elimina el proyecto, sus agentes, versiones, ejecuciones, secretos, archivos administrados y auditoría asociada. No se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => void remove()} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {busy && <LoaderCircle className="animate-spin" />}Eliminar definitivamente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
