"use client";

import { useState, type FormEvent } from "react";
import { FolderPlus, LoaderCircle, Plus } from "lucide-react";
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
import { requestBff } from "@/lib/marcus/client";
import type { Project } from "@/lib/marcus/types";

export function CreateProjectDialog() {
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
      const project = await requestBff<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ slug: form.get("slug"), name: form.get("name") }),
      });
      setOpen(false);
      toast.success(`Proyecto ${project.name} creado`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo crear el proyecto.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus />Nuevo proyecto</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FolderPlus /></div>
          <DialogTitle>Crear Project Home</DialogTitle>
          <DialogDescription>Registrá un workspace administrado por marcusd.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
              <Input id="project-slug" name="slug" placeholder="mi-proyecto" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required autoFocus />
              <FieldDescription>Minúsculas, números y guiones.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-name">Nombre</FieldLabel>
              <Input id="project-name" name="name" placeholder="Mi proyecto" maxLength={120} required />
            </Field>
          </FieldGroup>
          <p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={submitting}>{submitting && <LoaderCircle className="animate-spin" />}Crear proyecto</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
