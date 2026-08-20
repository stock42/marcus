"use client";

import { useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { requestBff } from "@/lib/marcus/client";
import type { UploadSession } from "@/lib/marcus/types";

const CHUNK_BYTES = 192 * 1024;

export function UploadFileDialog({ projectId }: { projectId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File>();
  const [destination, setDestination] = useState("project:/");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const busy = progress > 0 && progress < 100;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file === undefined) return;
    setError("");
    setProgress(1);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const resolvedDestination = destination.endsWith("/") ? `${destination}${file.name}` : destination;
      const upload = await requestBff<UploadSession>(`/api/projects/${encodeURIComponent(projectId)}/uploads`, {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, destination: resolvedDestination, size: bytes.length }),
      });
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length));
        await requestBff(`/api/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(upload.uploadId)}/chunks/${offset}`, {
          method: "PUT",
          body: JSON.stringify({ data: bytesToBase64(chunk) }),
        });
        setProgress(Math.max(2, Math.round(((offset + chunk.length) / Math.max(bytes.length, 1)) * 95)));
      }
      await requestBff(`/api/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(upload.uploadId)}/commit`, { method: "POST", body: "{}" });
      setProgress(100);
      toast.success(`${file.name} subido`);
      setOpen(false);
      setFile(undefined);
      formRef.current?.reset();
      router.refresh();
    } catch (reason) {
      setProgress(0);
      setError(reason instanceof Error ? reason.message : "No se pudo subir el archivo.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
      <DialogTrigger asChild><Button variant="outline"><Upload />Subir archivo</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Subir desde tu computadora</DialogTitle><DialogDescription>Hasta 100 MiB, en chunks reanudables validados por Marcus API.</DialogDescription></DialogHeader>
        <form ref={formRef} onSubmit={submit} className="space-y-5">
          <Field>
            <FieldLabel htmlFor="local-file">Archivo local</FieldLabel>
            <Input id="local-file" type="file" required onChange={(event) => {
              const selected = event.target.files?.[0];
              setFile(selected);
              if (selected !== undefined) setDestination(`project:/${selected.name}`);
            }} />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-destination">Destino lógico</FieldLabel>
            <Input id="upload-destination" value={destination} onChange={(event) => setDestination(event.target.value)} required />
            <FieldDescription>Puede ser una carpeta o un nombre dentro de project:/</FieldDescription>
          </Field>
          {progress > 0 && <div className="space-y-2" role="status"><Progress value={progress} /><p className="text-xs text-muted-foreground">{progress < 100 ? `Subiendo… ${progress}%` : "Carga completada"}</p></div>}
          <p className="min-h-5 text-sm text-destructive" role="alert">{error}</p>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button><Button type="submit" disabled={file === undefined || busy}>{busy && <LoaderCircle className="animate-spin" />}Subir</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}
