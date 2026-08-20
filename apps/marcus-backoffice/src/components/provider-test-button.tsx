"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestBff } from "@/lib/marcus/client";

export function ProviderTestButton({ provider }: { provider: string }) {
  const [testing, setTesting] = useState(false);
  const router = useRouter();
  async function testProvider() {
    setTesting(true);
    try {
      const result = await requestBff<{ probe: { healthy: boolean; latencyMs: number; models: string[]; error?: { message: string } } }>(`/api/providers/${encodeURIComponent(provider)}/test`, { method: "POST", body: "{}" });
      if (!result.probe.healthy) throw new Error(result.probe.error?.message ?? "El proveedor no respondió correctamente.");
      toast.success("Proveedor disponible", { description: `${result.probe.latencyMs} ms · ${result.probe.models.length} modelos` });
      router.refresh();
    } catch (error) {
      toast.error("Falló la prueba del proveedor", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  }
  return <Button type="button" variant="outline" size="sm" disabled={testing} onClick={testProvider}>{testing ? <LoaderCircle className="animate-spin" /> : <PlugZap />}{testing ? "Probando…" : "Probar"}</Button>;
}
