"use client";

import { Fragment, useCallback, useMemo, useRef, useState, type UIEvent } from "react";
import { Bot, Check, Code2, Eye, FileText, LoaderCircle, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AgentGenerationActivity, useAgentActivity } from "@/components/agent-generation-activity";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { requestBff } from "@/lib/marcus/client";
import type { AcceptedAgentActivity, AgentActivity, AssistantResponse, ProjectFile, ProjectFileContent } from "@/lib/marcus/types";
import { cn } from "@/lib/utils";

export function MarkdownEditor({ projectId, path, initialContent, revision }: { projectId: string; path: string; initialContent: string; revision: number }) {
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [currentRevision, setCurrentRevision] = useState(revision);
  const [saving, setSaving] = useState(false);
  const isMarkdown = /\.md$/iu.test(path);
  const isAgentMarkdown = /\.agent\.md$/iu.test(path);
  const dirty = content !== savedContent;

  async function save() {
    setSaving(true);
    try {
      const result = await requestBff<{ revision: number }>(`/api/projects/${encodeURIComponent(projectId)}/files`, {
        method: "PUT",
        body: JSON.stringify({ path, content, expectedRevision: currentRevision }),
      });
      setCurrentRevision(result.revision);
      setSavedContent(content);
      toast.success("Archivo guardado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el archivo.");
    } finally {
      setSaving(false);
    }
  }

  function applyAgentAiEdit(nextContent: string, nextRevision: number) {
    setContent(nextContent);
    setSavedContent(nextContent);
    setCurrentRevision(nextRevision);
  }

  return (
    <Card className="min-h-[70dvh] overflow-hidden border-border/75 bg-card/55">
      <CardHeader className="border-b border-border/70 lg:grid-cols-[1fr_auto]">
        <div><CardTitle className="flex items-center gap-2"><FileText className="size-4 text-primary" />{path}</CardTitle><CardDescription>Revisión v{currentRevision} · UTF-8 · guardado con control optimista.</CardDescription></div>
        <div className="flex flex-wrap items-center gap-2">
          {isAgentMarkdown && <AgentAiEditDialog projectId={projectId} path={path} disabled={dirty || saving} onApplied={applyAgentAiEdit} />}
          <Button onClick={() => void save()} disabled={!dirty || saving}>{saving ? <LoaderCircle className="animate-spin" /> : dirty ? <Save /> : <Check />} {dirty ? "Guardar cambios" : "Guardado"}</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isMarkdown ? (
          <Tabs defaultValue="editor">
            <div className="border-b border-border/70 px-4 py-2"><TabsList><TabsTrigger value="editor"><Code2 />Editor</TabsTrigger><TabsTrigger value="preview"><Eye />Vista previa</TabsTrigger></TabsList></div>
            <TabsContent value="editor" className="m-0">
              <MarkdownSourceEditor value={content} onChange={setContent} />
            </TabsContent>
            <TabsContent value="preview" className="m-0 min-h-[62dvh] p-6"><MarkdownPreview content={content} /></TabsContent>
          </Tabs>
        ) : (
          <Textarea aria-label="Contenido del archivo" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} className="min-h-[62dvh] resize-none rounded-none border-0 bg-transparent p-5 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0" />
        )}
      </CardContent>
    </Card>
  );
}

function AgentAiEditDialog({ projectId, path, disabled, onApplied }: { projectId: string; path: string; disabled: boolean; onApplied: (content: string, revision: number) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [activityId, setActivityId] = useState<string>();
  const handledActivityRef = useRef<string | undefined>(undefined);
  const applyCompletedEdit = useCallback(async (response: AssistantResponse) => {
    try {
      const wroteTarget = response.actions.some((action) => action.tool === "files_write" && action.arguments.path === path);
      if (!wroteTarget) throw new Error("Marcus AI no confirmó la escritura del agente.");
      const query = new URLSearchParams({ path });
      const [file, metadata] = await Promise.all([
        requestBff<ProjectFileContent>(`/api/projects/${encodeURIComponent(projectId)}/files/content?${query}`),
        requestBff<ProjectFile>(`/api/projects/${encodeURIComponent(projectId)}/files/stat?${query}`),
      ]);
      onApplied(decodeBase64(file.data), metadata.revision);
      setResult(response.message);
      toast.success("Agente actualizado y nueva versión activada");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo sincronizar el archivo actualizado.");
    }
  }, [onApplied, path, projectId]);
  const handleActivity = useCallback((activity: AgentActivity<AssistantResponse>) => {
    if (activity.status === "running" || handledActivityRef.current === activity.activityId) return;
    handledActivityRef.current = activity.activityId;
    setBusy(false);
    if (activity.status === "failed") {
      setError(`${activity.error?.code ?? "ASSISTANT_EDIT_FAILED"}: ${activity.error?.message ?? "Marcus AI no pudo editar el agente."}`);
      return;
    }
    const response = activity.result;
    if (response === undefined) {
      setError("ASSISTANT_RESULT_MISSING: La edición terminó sin resultado.");
      return;
    }
    void applyCompletedEdit(response);
  }, [applyCompletedEdit]);
  const realtime = useAgentActivity<AssistantResponse>(activityId, projectId, undefined, handleActivity);
  const activity = realtime.data;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const instruction = String(new FormData(form).get("instruction") ?? "").trim();
    if (instruction === "") return;
    setBusy(true);
    setError("");
    setResult("");
    setActivityId(undefined);
    handledActivityRef.current = undefined;
    try {
      const response = await requestBff<AcceptedAgentActivity>("/api/assistant", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          mode: "agent-file-edit",
          path,
          messages: [{
            role: "user",
            content: `Editá exclusivamente el agente Markdown ubicado en ${path}. Aplicá este pedido: ${instruction}\n\nLeé primero el archivo, preservá todo lo no solicitado y escribí el contenido completo actualizado en el mismo path. CONFIRMAR SOBRESCRIBIR ${path}`,
          }],
        }),
      });
      setActivityId(response.activityId);
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Marcus AI no pudo editar el agente.");
      setBusy(false);
    }
  }

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) { setError(""); setResult(""); }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled} title={disabled ? "Guardá primero los cambios manuales" : undefined}><Bot />Agente AI</Button></DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles /></div>
          <DialogTitle>Editar con Agente AI</DialogTitle>
          <DialogDescription>Describí el cambio. Marcus AI sólo podrá leer y sobrescribir este archivo: <code className="font-mono text-xs text-foreground">{path}</code>.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <Field>
            <FieldLabel htmlFor="agent-ai-instruction">¿Qué querés cambiar?</FieldLabel>
            <Textarea id="agent-ai-instruction" name="instruction" required minLength={3} maxLength={4_000} rows={7} autoFocus disabled={busy || result !== ""} placeholder="Ejemplo: agregá api-enabled: true y documentá el endpoint esperado sin modificar el resto del agente." className="min-h-40 resize-y" />
            <FieldDescription>Al aplicar autorizás que Marcus AI sobrescriba este `.agent.md`. Marcus validará el resultado, registrará una versión inmutable y la activará.</FieldDescription>
          </Field>
          {busy && activity === undefined && <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary" role="status"><LoaderCircle className="size-4 animate-spin" />Marcus AI está iniciando la edición…</div>}
          {activity !== undefined && <AgentGenerationActivity progress={activity} failure={realtime.error} />}
          {result !== "" && <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6"><strong className="mb-1 block text-primary">Cambio aplicado y versión activada</strong>{result}</div>}
          {error !== "" && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={busy}>{result === "" ? "Cancelar" : "Cerrar"}</Button>
            {result === "" && <Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Aplicar con Agente AI</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function decodeBase64(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0)));
}

function MarkdownSourceEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const highlighter = useRef<HTMLPreElement>(null);

  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (highlighter.current === null) return;
    highlighter.current.scrollTop = event.currentTarget.scrollTop;
    highlighter.current.scrollLeft = event.currentTarget.scrollLeft;
  }

  return (
    <div className="relative h-[62dvh] min-h-[30rem] overflow-hidden bg-background/20" data-markdown-source-editor>
      <pre
        ref={highlighter}
        aria-hidden="true"
        data-markdown-highlighter
        className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre p-5 font-mono text-[13px] leading-6 md:text-[13px]"
      >
        <code>{highlightMarkdownSource(value)}</code>
      </pre>
      <Textarea
        aria-label="Contenido Markdown"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        wrap="off"
        className="relative z-10 h-full min-h-full field-sizing-fixed resize-none overflow-auto whitespace-pre rounded-none border-0 bg-transparent p-5 font-mono text-[13px] leading-6 text-transparent caret-foreground shadow-none selection:bg-primary/25 focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
        style={{ WebkitTextFillColor: "transparent" }}
      />
    </div>
  );
}

function highlightMarkdownSource(source: string): React.ReactNode[] {
  const lines = source.split("\n");
  let inCode = false;
  let inFrontmatter = false;
  return lines.map((line, index) => {
    const trimmed = line.trim();
    let kind = "text";
    let className = "text-foreground/80";

    if (index === 0 && trimmed === "---") {
      inFrontmatter = true;
      kind = "frontmatter";
      className = "font-semibold text-primary/75";
    } else if (inFrontmatter) {
      kind = "frontmatter";
      className = trimmed === "---" ? "font-semibold text-primary/75" : "text-violet-700 dark:text-violet-300";
      if (trimmed === "---") inFrontmatter = false;
    } else if (/^(```|~~~)/u.test(trimmed)) {
      inCode = !inCode;
      kind = "code-fence";
      className = "font-semibold text-amber-700 dark:text-amber-300";
    } else if (inCode) {
      kind = "code";
      className = "text-cyan-700 dark:text-cyan-300";
    } else if (/^\s*#{1,6}\s+/u.test(line)) {
      kind = "heading";
      className = "font-semibold text-primary";
    } else if (/^\s*(?:[-*+] |\d+\. )/u.test(line)) {
      kind = "list";
      className = "text-emerald-700 dark:text-emerald-300";
    } else if (/^\s*>\s?/u.test(line)) {
      kind = "quote";
      className = "italic text-muted-foreground";
    } else if (trimmed === "") {
      kind = "blank";
    }

    return (
      <Fragment key={index}>
        <span data-markdown-token={kind} className={className}>{line === "" ? "\u200b" : line}</span>
        {index < lines.length - 1 ? "\n" : null}
      </Fragment>
    );
  });
}

export function MarkdownPreview({ content, inverse = false }: { content: string; inverse?: boolean }) {
  const blocks = useMemo(() => tokenizeMarkdown(content), [content]);
  return (
    <article className={cn("max-w-none space-y-4 text-sm leading-7", inverse ? "text-zinc-200" : "text-foreground")}>
      {blocks.map((block, index) => {
        if (block.kind === "code") return <pre key={index} className={cn("overflow-x-auto rounded-xl border p-4 font-mono text-xs leading-6", inverse ? "border-white/10 bg-white/5 text-cyan-100" : "border-border bg-muted/45 text-foreground")}><code>{block.value}</code></pre>;
        if (block.kind === "heading") {
          const Tag = `h${Math.min(block.level, 4)}` as "h1" | "h2" | "h3" | "h4";
          return <Tag key={index} className="pt-2 text-xl font-semibold tracking-tight">{inlineMarkdown(block.value)}</Tag>;
        }
        if (block.kind === "list") return <ul key={index} className="list-disc space-y-1 pl-6">{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>;
        return <p key={index} className={cn(inverse && "text-zinc-300")}>{inlineMarkdown(block.value)}</p>;
      })}
    </article>
  );
}

type Block = { kind: "paragraph"; value: string } | { kind: "heading"; value: string; level: number } | { kind: "code"; value: string } | { kind: "list"; items: string[] };
function tokenizeMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) code.push(lines[index++] ?? "");
      index += 1;
      blocks.push({ kind: "code", value: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/u);
    if (heading !== null) { blocks.push({ kind: "heading", level: heading[1]!.length, value: heading[2]! }); index += 1; continue; }
    if (/^\s*[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/u.test(lines[index] ?? "")) items.push((lines[index++] ?? "").replace(/^\s*[-*]\s+/u, ""));
      blocks.push({ kind: "list", items });
      continue;
    }
    if (line.trim() === "") { index += 1; continue; }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() !== "" && !/^(#{1,4})\s+|^```|^\s*[-*]\s+/u.test(lines[index] ?? "")) paragraph.push(lines[index++] ?? "");
    blocks.push({ kind: "paragraph", value: paragraph.join("\n") });
  }
  return blocks;
}

function inlineMarkdown(value: string): React.ReactNode {
  const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*)/gu);
  return parts.map((part, index) => part.startsWith("`") && part.endsWith("`")
    ? <code key={index} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">{part.slice(1, -1)}</code>
    : part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}
