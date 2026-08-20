"use client";

import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Bot, CheckCircle2, Clipboard, Code2, FileText, LoaderCircle, Play, ShieldAlert, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AgentGenerationActivity, initialAgentGenerationProgress, useAgentActivity, type AgentGenerationFailure } from "@/components/agent-generation-activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MarcusBffError, requestBff } from "@/lib/marcus/client";
import type { AcceptedAgentActivity, AgentActivity, AgentPlan, GeneratedAgent, Project } from "@/lib/marcus/types";

export function AgentStudio({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.projectId ?? "");
  const [sourceKind, setSourceKind] = useState<"markdown" | "sdk">("markdown");
  const [brief, setBrief] = useState("");
  const [plan, setPlan] = useState<AgentPlan>();
  const [busy, setBusy] = useState<"planning" | "creating">();
  const [planningError, setPlanningError] = useState("");
  const [planningActivityId, setPlanningActivityId] = useState<string>();
  const [generationProgress, setGenerationProgress] = useState<AgentActivity<GeneratedAgent>>();
  const [generationFailure, setGenerationFailure] = useState<AgentGenerationFailure>();
  const handledPlanningRef = useRef<string | undefined>(undefined);
  const handledGenerationRef = useRef<string | undefined>(undefined);
  const selectedProject = useMemo(() => projects.find((project) => project.projectId === projectId), [projectId, projects]);
  const handlePlanningActivity = useCallback((activity: AgentActivity<AgentPlan>) => {
    if (activity === undefined || activity.status === "running" || handledPlanningRef.current === activity.activityId) return;
    handledPlanningRef.current = activity.activityId;
    setBusy(undefined);
    if (activity.status === "failed") {
      setPlanningError(`${activity.error?.code ?? "AGENT_PLAN_FAILED"}: ${activity.error?.message ?? "No se pudo planificar el agente."}`);
      return;
    }
    if (activity.result === undefined) {
      setPlanningError("AGENT_PLAN_RESULT_MISSING: La planificación terminó sin resultado.");
      return;
    }
    setPlan(activity.result);
  }, []);
  const handleGenerationActivity = useCallback((activity: AgentActivity<GeneratedAgent>) => {
    if (activity === undefined || activity.status === "running" || handledGenerationRef.current === activity.activityId) return;
    handledGenerationRef.current = activity.activityId;
    setBusy(undefined);
    if (activity.status === "failed") {
      setGenerationFailure(activity.error ?? { code: "AGENT_GENERATION_FAILED", message: "No se pudo crear el agente." });
      return;
    }
    const result = activity.result;
    if (result === undefined) {
      setGenerationFailure({ code: "AGENT_GENERATION_RESULT_MISSING", message: "La actividad terminó sin resultado." });
      return;
    }
    toast.success(`${result.manifest.identity.name} creado y activado`);
    router.push(`/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(result.manifest.identity.id)}`);
    router.refresh();
  }, [projectId, router]);
  const planningRealtime = useAgentActivity<AgentPlan>(planningActivityId, projectId, undefined, handlePlanningActivity);
  const generationRealtime = useAgentActivity<GeneratedAgent>(generationProgress?.activityId, projectId, generationProgress, handleGenerationActivity);
  const generationActivity = generationRealtime.data ?? generationProgress;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("planning");
    setPlanningError("");
    setPlan(undefined);
    setPlanningActivityId(undefined);
    setGenerationProgress(undefined);
    setGenerationFailure(undefined);
    try {
      const accepted = await requestBff<AcceptedAgentActivity>(`/api/projects/${encodeURIComponent(projectId)}/agents/plan`, {
        method: "POST",
        body: JSON.stringify({ prompt: brief, sourceKind }),
      });
      handledPlanningRef.current = undefined;
      setPlanningActivityId(accepted.activityId);
    } catch (reason) {
      setPlanningError(reason instanceof Error ? reason.message : "No se pudo planificar el agente.");
      setBusy(undefined);
    }
  }

  async function createMarkdown() {
    if (plan === undefined) return;
    setBusy("creating");
    setGenerationFailure(undefined);
    const progressId = `generation_${crypto.randomUUID()}`;
    handledGenerationRef.current = undefined;
    setGenerationProgress(initialAgentGenerationProgress(progressId));
    try {
      await requestBff<AcceptedAgentActivity>(`/api/projects/${encodeURIComponent(projectId)}/agents`, {
        method: "POST",
        body: JSON.stringify({ prompt: `${brief}\n\nPlan aprobado:\n${JSON.stringify(plan, null, 2)}`, progressId }),
      });
    } catch (reason) {
      const detail = reason instanceof MarcusBffError ? { code: reason.code, message: reason.message } : { code: "AGENT_GENERATION_FAILED", message: reason instanceof Error ? reason.message : "No se pudo crear el agente." };
      setGenerationFailure(detail);
      setGenerationProgress((current) => current === undefined ? current : { ...current, status: "failed", stage: "failed", message: `${detail.code}: ${detail.message}`, error: detail });
      setBusy(undefined);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(340px,0.78fr)_minmax(0,1.22fr)]">
      <Card className="h-fit border-border/75 bg-card/55 xl:sticky xl:top-24">
        <CardHeader><div className="mb-2 flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Sparkles /></div><CardTitle>Brief del agente</CardTitle><CardDescription>Separá el diseño de la implementación. Marcus devuelve un contrato revisable sin tocar el Project.</CardDescription></CardHeader>
        <CardContent><form onSubmit={submit} className="space-y-5">
          <Field><FieldLabel htmlFor="studio-project">Project</FieldLabel><NativeSelect id="studio-project" value={projectId} onChange={(event) => { setProjectId(event.target.value); setPlan(undefined); }} className="w-full"><NativeSelectOption value="" disabled>Seleccioná un Project</NativeSelectOption>{projects.map((project) => <NativeSelectOption key={project.projectId} value={project.projectId}>{project.name} · {project.slug}</NativeSelectOption>)}</NativeSelect></Field>
          <Field><FieldLabel>Formato de fuente</FieldLabel><Tabs value={sourceKind} onValueChange={(value) => { setSourceKind(value as "markdown" | "sdk"); setPlan(undefined); }}><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="markdown"><FileText />Markdown</TabsTrigger><TabsTrigger value="sdk"><Code2 />TypeScript SDK</TabsTrigger></TabsList></Tabs><FieldDescription>Markdown para contratos declarativos; SDK para lógica y lifecycle personalizados.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="studio-brief">Necesidad</FieldLabel><Textarea id="studio-brief" value={brief} onChange={(event) => setBrief(event.target.value)} minLength={12} maxLength={20_000} required className="min-h-64 resize-y leading-relaxed" placeholder="El agente debe recibir…, consultar…, respetar…, devolver…, ejecutarse por…" /><FieldDescription>Incluí entradas, resultado esperado, fuentes de datos, herramientas, límites y criterios de éxito.</FieldDescription></Field>
          <p className="min-h-5 text-sm text-destructive" role="alert">{planningError}</p>
          <Button type="submit" size="lg" className="w-full" disabled={busy !== undefined || projectId === ""}>{busy === "planning" ? <LoaderCircle className="animate-spin" /> : <Bot />}{busy === "planning" ? "Arquitectando…" : "Planificar agente"}</Button>
          {planningRealtime.data !== undefined && plan === undefined && <AgentGenerationActivity progress={planningRealtime.data} failure={planningRealtime.error} />}
        </form></CardContent>
      </Card>

      {plan === undefined ? <Card className="grid min-h-[640px] place-items-center border-dashed border-border/75 bg-card/25"><CardContent className="max-w-md text-center"><Bot className="mx-auto size-10 text-primary" /><h2 className="mt-5 text-xl font-semibold">Una mesa de diseño antes del código</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">El plan explicitará arquitectura, contrato, archivos, tools, pasos, pruebas y riesgos. Después decidís si Marcus genera el Markdown o si Codex/Claude implementa el SDK por MCP.</p></CardContent></Card> : <PlanView plan={plan} project={selectedProject} busy={busy} progress={generationActivity} failure={generationFailure ?? generationRealtime.error} onCreate={() => void createMarkdown()} />}
    </div>
  );
}

function PlanView({ plan, project, busy, progress, failure, onCreate }: { plan: AgentPlan; project?: Project; busy?: "planning" | "creating"; progress?: AgentActivity<GeneratedAgent>; failure?: AgentGenerationFailure; onCreate(): void }) {
  const serialized = JSON.stringify(plan, null, 2);
  return <div className="space-y-5" data-agent-plan>
    <Card className="border-primary/25 bg-primary/[0.035]"><CardHeader><div className="flex flex-wrap items-center gap-2"><Badge>{plan.sourceKind === "markdown" ? "Markdown" : "TypeScript SDK"}</Badge><Badge variant="outline">{plan.provider} · {plan.model}</Badge></div><CardTitle className="text-2xl">{plan.name}</CardTitle><CardDescription className="text-sm leading-relaxed">{plan.summary}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void navigator.clipboard.writeText(serialized).then(() => toast.success("Plan copiado"))}><Clipboard />Copiar plan</Button>{plan.sourceKind === "markdown" ? <Button onClick={onCreate} disabled={busy !== undefined}>{busy === "creating" ? <LoaderCircle className="animate-spin" /> : <Play />}{busy === "creating" ? "Generando y compilando…" : "Crear y activar"}</Button> : <Button variant="outline" onClick={() => void navigator.clipboard.writeText(`Usá el prompt create-typescript-agent de Marcus MCP para implementar este plan en el Project ${project?.projectId ?? ""}:\n\n${serialized}`).then(() => toast.success("Prompt para Codex/Claude copiado"))}><Code2 />Copiar prompt MCP<ArrowRight /></Button>}</div>{progress !== undefined && <AgentGenerationActivity progress={progress} failure={failure} />}</CardContent></Card>
    <PlanSection title="Arquitectura" icon={Bot}><p className="text-sm leading-relaxed text-muted-foreground">{plan.architecture}</p></PlanSection>
    <div className="grid gap-5 md:grid-cols-2"><ListSection title="Entradas" items={plan.inputs} /><ListSection title="Salidas" items={plan.outputs} /><ListSection title="Tools y capacidades" items={plan.tools} /><ListSection title="Archivos" items={plan.files} mono /></div>
    <PlanSection title="Ruta de implementación" icon={CheckCircle2}><ol className="space-y-3">{plan.steps.map((step, index) => <li key={`${step}-${index}`} className="flex gap-3 text-sm"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs text-primary">{index + 1}</span><span className="pt-0.5 text-muted-foreground">{step}</span></li>)}</ol></PlanSection>
    <div className="grid gap-5 md:grid-cols-2"><ListSection title="Casos de prueba" items={plan.testCases} /><PlanSection title="Riesgos operativos" icon={ShieldAlert}>{plan.risks.length === 0 ? <p className="text-sm text-muted-foreground">Sin riesgos adicionales identificados.</p> : <ul className="space-y-2">{plan.risks.map((risk) => <li key={risk} className="flex gap-2 text-sm text-muted-foreground"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />{risk}</li>)}</ul>}</PlanSection></div>
  </div>;
}

function PlanSection({ title, icon: Icon, children }: { title: string; icon: typeof Bot; children: React.ReactNode }) { return <Card className="border-border/75 bg-card/55"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-primary" />{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>; }
function ListSection({ title, items, mono = false }: { title: string; items: string[]; mono?: boolean }) { return <PlanSection title={title} icon={title === "Archivos" ? FileText : CheckCircle2}>{items.length === 0 ? <p className="text-sm text-muted-foreground">No requerido.</p> : <ul className="space-y-2">{items.map((item) => <li key={item} className={`rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-sm text-muted-foreground ${mono ? "font-mono text-xs" : ""}`}>{item}</li>)}</ul>}</PlanSection>; }
