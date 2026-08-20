"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { SystemOverview } from "@/lib/marcus/types";

const chartConfig = {
  runs: { label: "Runs", color: "var(--chart-1)" },
  failed: { label: "Fallidos", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function SystemRunsChart({ data }: { data: SystemOverview["trend"] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[280px] w-full" initialDimension={{ width: 900, height: 280 }}>
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 4, top: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={22} tickFormatter={(value: string) => value.slice(5)} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="runs" fill="var(--color-runs)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="failed" fill="var(--color-failed)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
