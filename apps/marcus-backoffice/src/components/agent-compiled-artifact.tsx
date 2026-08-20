"use client";

import { useState } from "react";
import { Braces, Check, Clipboard, Code2, FileJson2, LoaderCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requestBff } from "@/lib/marcus/client";
import type { CompiledAgentArtifact } from "@/lib/marcus/types";

type Props = {
  projectId: string;
  agent: string;
  versionId: string;
};

export function AgentCompiledArtifact({ projectId, agent, versionId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [artifact, setArtifact] = useState<CompiledAgentArtifact>();
  const [error, setError] = useState<string>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      setArtifact(await requestBff<CompiledAgentArtifact>(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/versions/${encodeURIComponent(versionId)}/compiled`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el artefacto compilado.");
    } finally {
      setLoading(false);
    }
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next && artifact === undefined && !loading) void load();
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" variant="ghost" size="sm"><Code2 />Ver compilado</Button></DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Braces /></div>
          <DialogTitle>Artefacto compilado</DialogTitle>
          <DialogDescription>Inspeccioná el JavaScript exacto que carga Runtime Host, el TypeScript intermedio generado desde Markdown y el manifest registrado.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0">
          {loading && <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />Cargando artefacto…</div>}
          {error !== undefined && <div className="flex min-h-80 flex-col items-center justify-center gap-4 text-center"><p className="max-w-lg text-sm text-destructive" role="alert">{error}</p><Button type="button" variant="outline" onClick={() => void load()}><RotateCw />Reintentar</Button></div>}
          {artifact !== undefined && !loading && (
            <Tabs defaultValue="javascript" className="min-h-0 gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="javascript"><Code2 />JavaScript runtime</TabsTrigger>
                  <TabsTrigger value="typescript"><Braces />TypeScript generado</TabsTrigger>
                  <TabsTrigger value="manifest"><FileJson2 />Manifest JSON</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2"><Badge variant={artifact.status === "active" ? "default" : "outline"}>{artifact.status}</Badge><code className="text-xs text-muted-foreground">{artifact.agentVersionId}</code></div>
              </div>
              <TabsContent value="javascript"><CodePanel label="JavaScript runtime" value={artifact.runtimeJavaScript} dataAttribute="data-compiled-javascript" /></TabsContent>
              <TabsContent value="typescript"><CodePanel label="TypeScript generado" value={artifact.generatedTypeScript ?? "El TypeScript intermedio no está disponible para esta versión."} dataAttribute="data-compiled-typescript" /></TabsContent>
              <TabsContent value="manifest"><CodePanel label="Manifest JSON" value={JSON.stringify(artifact.manifest, null, 2)} dataAttribute="data-compiled-manifest" /></TabsContent>
            </Tabs>
          )}
        </div>
        <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cerrar</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CodePanel({ label, value, dataAttribute }: { label: string; value: string; dataAttribute: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(`${label} copiado`);
    window.setTimeout(() => setCopied(false), 1_500);
  }
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-background/60" aria-label={label}>
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-2"><span className="text-xs font-medium text-muted-foreground">{label}</span><Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>{copied ? <Check /> : <Clipboard />}{copied ? "Copiado" : "Copiar"}</Button></div>
      <pre className="max-h-[56dvh] overflow-auto p-4 text-xs leading-6" {...{ [dataAttribute]: "" }}><code>{value}</code></pre>
    </section>
  );
}
