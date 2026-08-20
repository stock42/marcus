"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestBff } from "@/lib/marcus/client";

export function CancelRunButton({ projectId, runId }: { projectId: string; runId: string }) {
  const [cancelling, setCancelling] = useState(false);
  const router = useRouter();
  async function cancel() {
    setCancelling(true);
    try {
      await requestBff(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", body: "{}" });
      toast.success("Cancelación solicitada");
      router.refresh();
    } catch (error) {
      toast.error("No se pudo cancelar el Run", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setCancelling(false);
    }
  }
  return <Button variant="destructive" onClick={cancel} disabled={cancelling}>{cancelling ? <LoaderCircle className="animate-spin" /> : <Ban />}{cancelling ? "Cancelando…" : "Cancelar Run"}</Button>;
}
