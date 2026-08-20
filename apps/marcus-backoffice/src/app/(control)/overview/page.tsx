import type { Metadata } from "next";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { SystemOverviewLive } from "@/components/system-overview-live";
import { requestMarcus } from "@/lib/marcus/server";
import type { SystemOverview } from "@/lib/marcus/types";

export const metadata: Metadata = { title: "Centro de control" };

export default async function OverviewPage() {
  const result = await requestMarcus<SystemOverview>("/api/v1/system/overview");
  if (!result.envelope.ok) return <ApiErrorPanel code={result.envelope.error.code} message={result.envelope.error.message} />;
  return <SystemOverviewLive initial={result.envelope.data} />;
}
