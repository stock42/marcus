"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MarcusRealtimeProvider } from "@/components/marcus-realtime";

export function AppProviders({ children, webSocketUrl }: { children: React.ReactNode; webSocketUrl: string }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
      <MarcusRealtimeProvider url={webSocketUrl}>
        <TooltipProvider delayDuration={250}>
          {children}
          <Toaster position="bottom-right" richColors />
        </TooltipProvider>
      </MarcusRealtimeProvider>
    </ThemeProvider>
  );
}
