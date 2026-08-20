"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { Bot, LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AgentGenerationActivity, initialAgentGenerationProgress, useAgentActivity, type AgentGenerationFailure } from "@/components/agent-generation-activity";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { MarcusBffError, requestBff } from "@/lib/marcus/client";
import type { AcceptedAgentActivity, AgentActivity, GeneratedAgent } from "@/lib/marcus/types";

export function GenerateAgentDialog({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AgentGenerationFailure>();
  const [progress, setProgress] = useState<AgentActivity<GeneratedAgent>>();
  const handledActivityRef = useRef<string | undefined>(undefined);
  const handleActivity = useCallback((activity: AgentActivity<GeneratedAgent>) => {
    if (activity === undefined || activity.status === "running" || handledActivityRef.current === activity.activityId) return;
    handledActivityRef.current = activity.activityId;
    setSubmitting(false);
    if (activity.status === "failed") {
      setFailure(activity.error ?? { code: "AGENT_GENERATION_FAILED", message: "Marcus no pudo completar la generación." });
      return;
    }
    const result = activity.result;
    if (result === undefined) {
      setFailure({ code: "AGENT_GENERATION_RESULT_MISSING", message: "La actividad terminó sin un resultado utilizable." });
      return;
    }
    setOpen(false);
    toast.success(`${result.manifest.identity.name} creado y activado`);
    router.push(`/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(result.manifest.identity.id)}`);
    router.refresh();
  }, [projectId, router]);
  const realtime = useAgentActivity<GeneratedAgent>(progress?.activityId, projectId, progress, handleActivity);
  const activity = realtime.data ?? progress;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFailure(undefined);
    const form = new FormData(event.currentTarget);
    const progressId = `generation_${crypto.randomUUID()}`;
    handledActivityRef.current = undefined;
    setProgress(initialAgentGenerationProgress(progressId));
    try {
      await requestBff<AcceptedAgentActivity>(`/api/projects/${encodeURIComponent(projectId)}/agents`, {
        method: "POST",
        body: JSON.stringify({ prompt: form.get("prompt"), progressId }),
      });
    } catch (reason) {
      const detail = reason instanceof MarcusBffError ? { code: reason.code, message: reason.message } : { code: "AGENT_GENERATION_FAILED", message: reason instanceof Error ? reason.message : "No se pudo crear el agente." };
      setFailure(detail);
      setProgress((current) => current === undefined ? current : {
        ...current,
        status: "failed",
        stage: "failed",
        message: `${detail.code}: ${detail.message}`,
        error: detail,
      });
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !submitting && setOpen(value)}>
      <DialogTrigger asChild><Button><Sparkles />Crear agente con AI</Button></DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot /></div>
          <DialogTitle>Describí el agente</DialogTitle>
          <DialogDescription>Marcus AI traducirá el pedido a Markdown ejecutable, lo validará, compilará y activará.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <Field>
            <FieldLabel htmlFor="agent-prompt">¿Qué tiene que hacer?</FieldLabel>
            <Textarea
              id="agent-prompt"
              name="prompt"
              required
              minLength={12}
              autoFocus
              className="min-h-56 resize-y text-sm leading-relaxed"
              placeholder="Creá un asistente que reciba el texto de una alerta, determine severidad y devuelva un resumen con acciones recomendadas..."
            />
            <FieldDescription>Incluí entradas, salidas, reglas, herramientas y forma de ejecución esperada.</FieldDescription>
          </Field>
          {activity !== undefined && <AgentGenerationActivity progress={activity} failure={failure ?? realtime.error} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancelar</Button>
            <Button type="submit" disabled={submitting}>{submitting && <LoaderCircle className="animate-spin" />}Generar agente</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
