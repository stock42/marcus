"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Bot, CheckCircle2, Copy, LoaderCircle, Send, Sparkles, TerminalSquare, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentGenerationActivity, useAgentActivity } from "@/components/agent-generation-activity";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownPreview } from "@/components/markdown-editor";
import { requestBff } from "@/lib/marcus/client";
import type { AcceptedAgentActivity, AgentActivity, AssistantMessage, AssistantResponse } from "@/lib/marcus/types";

const starters = [
  "¿Cómo creo mi primer agente Markdown?",
  "Revisá el estado de Marcus y explicame cualquier problema",
  "Listá los agentes de este proyecto y resumí qué hace cada uno",
];

export function MarcusAiDrawer({ projectId }: { projectId?: string }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [actions, setActions] = useState<AssistantResponse["actions"]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [activityId, setActivityId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const handledActivityRef = useRef<string | undefined>(undefined);
  const handleActivity = useCallback((activity: AgentActivity<AssistantResponse>) => {
    if (activity === undefined || activity.status === "running" || handledActivityRef.current === activity.activityId) return;
    handledActivityRef.current = activity.activityId;
    setBusy(false);
    if (activity.status === "failed") {
      setError(`${activity.error?.code ?? "ASSISTANT_FAILED"}: ${activity.error?.message ?? "Marcus AI no pudo responder."}`);
      return;
    }
    const response = activity.result;
    if (response === undefined) {
      setError("ASSISTANT_RESULT_MISSING: Marcus AI terminó sin una respuesta utilizable.");
      return;
    }
    setConversationId(response.conversationId);
    setMessages((current) => [...current, { role: "assistant" as const, content: response.message }].slice(-30));
    setActions(response.actions);
  }, []);
  const realtime = useAgentActivity<AssistantResponse>(activityId, projectId, undefined, handleActivity);
  const activity = realtime.data;

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, actions, activity, busy, open]);

  async function send(content = prompt) {
    const normalized = content.trim();
    if (normalized === "" || busy) return;
    const nextMessages = [...messages, { role: "user" as const, content: normalized }].slice(-30);
    setMessages(nextMessages);
    setPrompt("");
    setActions([]);
    setError("");
    setBusy(true);
    setActivityId(undefined);
    handledActivityRef.current = undefined;
    try {
      const response = await requestBff<AcceptedAgentActivity>("/api/assistant", {
        method: "POST",
        body: JSON.stringify({ messages: nextMessages, ...(projectId === undefined ? {} : { projectId }), ...(conversationId === undefined ? {} : { conversationId }) }),
      });
      setActivityId(response.activityId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Marcus AI no pudo responder.");
      setBusy(false);
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void send(); }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="top" shouldScaleBackground={false}>
      <Tooltip><TooltipTrigger asChild><span className="inline-flex"><DrawerTrigger asChild><Button variant="outline" size="sm" aria-label="Abrir Marcus AI"><Bot /><span className="hidden lg:inline">Marcus AI</span></Button></DrawerTrigger></span></TooltipTrigger><TooltipContent>Marcus AI</TooltipContent></Tooltip>
      <DrawerContent className="!h-[100dvh] !max-h-[100dvh] !overflow-hidden !rounded-none !border-0 bg-background p-0 text-foreground data-[vaul-drawer-direction=top]:!h-[100dvh] data-[vaul-drawer-direction=top]:!max-h-[100dvh] data-[vaul-drawer-direction=top]:!rounded-none">
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
          <header className="relative z-10 border-b border-border bg-background/95 px-4 backdrop-blur-md sm:px-6">
            <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 sm:h-20">
              <DrawerHeader className="flex-row items-center gap-3 p-0 text-left"><span className="flex size-10 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary"><Bot /></span><div><DrawerTitle className="text-base text-foreground sm:text-lg">Marcus AI</DrawerTitle><DrawerDescription className="text-xs">Documentación, proyectos, agentes y operación</DrawerDescription></div></DrawerHeader>
              <div className="flex items-center gap-2"><span className="hidden items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-[11px] text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-primary" />{projectId === undefined ? "Contexto global" : "Proyecto activo"}</span><Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Cerrar Marcus AI"><X /></Button></div>
            </div>
          </header>

          <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1 px-4 sm:px-8">
              <div className="mx-auto w-full max-w-3xl py-8 sm:py-12">
                {messages.length === 0 ? (
                  <div className="flex min-h-[50dvh] flex-col justify-center">
                    <span className="mb-5 flex size-12 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary"><Sparkles /></span>
                    <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Construí y operá Marcus conversando.</h2>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">Conoce la documentación oficial y puede consultar el estado real, crear proyectos y agentes, editar archivos y operar ejecuciones usando Marcus API.</p>
                    <div className="mt-8 grid gap-3 sm:grid-cols-3">{starters.map((starter) => <button key={starter} type="button" onClick={() => void send(starter)} className="rounded-lg border border-border bg-card p-4 text-left text-sm leading-6 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted/50 hover:text-foreground"><TerminalSquare className="mb-4 size-4 text-primary" />{starter}</button>)}</div>
                  </div>
                ) : (
                  <div className="space-y-7">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-[85%]" : "max-w-full"}>{message.role === "user" ? <div className="rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">{message.content}</div> : <div className="group relative border-l border-primary/30 pl-5"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><Bot className="size-3.5" />Marcus AI</div><MarkdownPreview content={message.content} inverse /><Button variant="ghost" size="icon-sm" className="absolute right-0 top-0 text-muted-foreground opacity-0 group-hover:opacity-100" onClick={() => void navigator.clipboard.writeText(message.content)} aria-label="Copiar respuesta"><Copy /></Button></div>}</div>)}</div>
                )}
                {busy && activity === undefined && <div className="mt-7 flex items-center gap-3 border-l border-primary/30 pl-5 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin text-primary" />Marcus está iniciando la actividad…</div>}
                {activity !== undefined && <div className="mt-7"><AgentGenerationActivity progress={activity} failure={realtime.error} /></div>}
                {actions.length > 0 && <div className="mt-7 rounded-lg border border-border bg-card p-4"><div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground"><Wrench className="size-3.5 text-primary" />Acciones verificadas</div><div className="space-y-2">{actions.map((action, index) => <div key={`${action.tool}-${index}`} className="flex items-center gap-2 text-xs text-foreground"><CheckCircle2 className="size-3.5 text-primary" /><code>{action.tool}</code></div>)}</div></div>}
                {error !== "" && <div className="mt-7 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div>}
                <div ref={endRef} />
              </div>
            </ScrollArea>
            <form onSubmit={submit} className="border-t border-border bg-background/95 px-4 py-4 backdrop-blur-md sm:px-8 sm:py-5">
              <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-border bg-card p-2 shadow-xl shadow-black/20 focus-within:border-primary/45">
                <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={keyDown} placeholder="Preguntá, creá o administrá Marcus…" aria-label="Mensaje para Marcus AI" rows={1} className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-3 py-3 text-sm text-foreground shadow-none focus-visible:ring-0" />
                <Button type="submit" size="icon" disabled={busy || prompt.trim() === ""} className="mb-0.5 size-10 shrink-0" aria-label="Enviar mensaje">{busy ? <LoaderCircle className="animate-spin" /> : <Send />}</Button>
              </div>
              <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground">Enter para enviar · Shift+Enter para nueva línea · las acciones sensibles requieren confirmación exacta</p>
            </form>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
