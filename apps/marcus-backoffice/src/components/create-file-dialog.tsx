"use client";

import { useState, type FormEvent } from "react";
import { FilePlus2, LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requestBff } from "@/lib/marcus/client";
import type { ProjectFile } from "@/lib/marcus/types";

export function CreateFileDialog({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const file = await requestBff<ProjectFile>(`/api/projects/${encodeURIComponent(projectId)}/files`, {
        method: "PUT",
        body: JSON.stringify({ path: form.get("path"), content: form.get("content") }),
      });
      setOpen(false);
      toast.success(`${file.relativePath} guardado`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo crear el archivo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus />Nuevo archivo</Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FilePlus2 /></div>
          <DialogTitle>Crear archivo</DialogTitle>
          <DialogDescription>La escritura pasa por Marcus API y conserva revisiones.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="file-path">Path lógico</FieldLabel>
              <Input id="file-path" name="path" defaultValue="project:/notes.md" required autoFocus />
              <FieldDescription>Siempre relativo al Project Home, comenzando por project:/</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="file-content">Contenido inicial</FieldLabel>
              <Textarea id="file-content" name="content" className="min-h-52 font-mono text-sm" placeholder="# Notas" />
            </Field>
          </FieldGroup>
          <p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={submitting}>{submitting && <LoaderCircle className="animate-spin" />}Guardar archivo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
