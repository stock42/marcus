"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, KeyRound, LoaderCircle, Save, ServerCog, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { requestBff } from "@/lib/marcus/client";
import type { DefaultLlmConfiguration, ProviderCatalogEntry } from "@/lib/marcus/types";

export function DefaultLlmForm({ catalog, onConfigured, submitLabel = "Guardar y verificar" }: { catalog: ProviderCatalogEntry[]; onConfigured?: (configuration: DefaultLlmConfiguration) => void; submitLabel?: string }) {
  const router = useRouter();
  const [catalogId, setCatalogId] = useState<ProviderCatalogEntry["id"] | "">("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = catalog.find((provider) => provider.id === catalogId);

  function selectProvider(value: string) {
    const provider = catalog.find((entry) => entry.id === value);
    if (provider === undefined) return;
    setCatalogId(provider.id);
    setBaseUrl(provider.baseUrl);
    setModel(provider.defaultModel ?? "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === undefined) return;
    setSaving(true);
    try {
      const configuration = await requestBff<DefaultLlmConfiguration>("/api/config/default-llm", {
        method: "PUT",
        body: JSON.stringify({ catalogId: selected.id, provider: selected.id, baseUrl, apiKey, model }),
      });
      setApiKey("");
      toast.success("LLM global configurado", { description: `${selected.name} · ${model}` });
      onConfigured?.(configuration);
      router.refresh();
    } catch (error) {
      toast.error("No se pudo configurar el LLM", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="grid gap-2">
        <Label>Proveedor administrado por Marcus</Label>
        <RadioGroup value={catalogId} onValueChange={selectProvider} className="grid gap-3 sm:grid-cols-2" aria-label="Proveedor LLM">
          {catalog.map((provider) => {
            const thinking = provider.capabilities.thinking === true;
            return (
              <Label key={provider.id} htmlFor={`provider-${provider.id}`} className="relative flex cursor-pointer items-start gap-3 rounded-xl border border-border/75 bg-background/40 p-4 transition hover:border-primary/40 has-data-checked:border-primary/60 has-data-checked:bg-primary/[0.06]">
                <RadioGroupItem id={`provider-${provider.id}`} value={provider.id} className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium"><BrainCircuit className="size-4 text-primary" />{provider.name}{thinking && <Badge variant="outline" className="border-primary/25 text-[10px] text-primary"><Sparkles className="size-3" />Thinking</Badge>}</span>
                  <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{provider.description}</span>
                </span>
              </Label>
            );
          })}
        </RadioGroup>
        {catalog.length === 0 && <p className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">El catálogo de proveedores no está disponible. Reiniciá Marcus API y marcusd con la misma versión.</p>}
      </div>
      {selected !== undefined && (
        <details className="group rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-2"><ServerCog className="size-4 shrink-0 text-primary" /><code className="truncate">{baseUrl}</code><span className="ml-auto">Endpoint avanzado</span></summary>
          <div className="mt-3 grid gap-2 border-t border-border/60 pt-3">
            <Label htmlFor="default-base-url">URL base del proveedor</Label>
            <Input id="default-base-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
            <p>Modificala sólo si usás un gateway compatible o un endpoint privado.</p>
          </div>
        </details>
      )}
      <div className="grid gap-2">
        <Label htmlFor="default-api-key">API key</Label>
        <div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="default-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="••••••••••••••••" className="pl-9" autoComplete="new-password" required /></div>
        <p className="text-xs text-muted-foreground">Marcus la cifra en su SecretStore; el Backoffice no vuelve a leerla ni mostrarla.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="default-model">Modelo por defecto</Label>
        <Input id="default-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder={selected?.defaultModel ?? "Nombre exacto del modelo"} autoComplete="off" list="provider-model-examples" required />
        <datalist id="provider-model-examples">{selected?.modelExamples.map((example) => <option key={example} value={example} />)}</datalist>
        {selected?.id === "deepseek" && <p className="text-xs text-muted-foreground">Marcus habilita Thinking Mode en <code>high</code>, conserva el razonamiento sólo para continuidad interna y usa JSON Output.</p>}
      </div>
      <Button type="submit" size="lg" disabled={saving || selected === undefined}>
        {saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? "Verificando proveedor…" : submitLabel}
      </Button>
    </form>
  );
}
