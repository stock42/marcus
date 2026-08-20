"use client";

import { useState } from "react";
import { Bot, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { ProviderCatalogEntry } from "@/lib/marcus/types";
import { DefaultLlmForm } from "./default-llm-form";

export function DefaultLlmGate({ configured, catalog }: { configured: boolean; catalog: ProviderCatalogEntry[] }) {
  const [ready, setReady] = useState(configured);
  if (ready) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-background/96 p-4 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="llm-setup-title">
      <Card className="my-6 w-full max-w-2xl border-primary/25 bg-card/95 shadow-2xl shadow-primary/10">
        <CardHeader className="space-y-4 border-b border-border/70">
          <div className="flex size-12 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><Bot className="size-6" /></div>
          <div><h1 id="llm-setup-title" className="font-heading text-2xl font-medium leading-snug">Configuremos el primer LLM</h1><CardDescription className="mt-2 text-sm leading-relaxed">Marcus necesita un proveedor global y el rol <code>agent.default</code> antes de crear, asistir o ejecutar agentes con AI.</CardDescription></div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <DefaultLlmForm catalog={catalog} onConfigured={() => setReady(true)} submitLabel="Configurar Marcus" />
          <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><span>La API key viaja por la sesión autenticada hacia Marcus API y se persiste cifrada únicamente en marcusd.</span></div>
        </CardContent>
      </Card>
    </div>
  );
}
