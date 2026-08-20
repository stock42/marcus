"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Boxes, ChevronRight, FolderKanban, Gauge, LayoutDashboard, RadioTower, RefreshCw, ScrollText, Search, Settings2, ShieldCheck, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { LogoutButton } from "./logout-button";
import { MarcusAiDrawer } from "./marcus-ai-drawer";
import { ContextualHelp } from "./contextual-help";
import { useMarcusRealtime, useRealtimeStatus } from "./marcus-realtime";

export function AppShell({ children, systemAdmin, username }: { children: React.ReactNode; systemAdmin: boolean; username?: string }) {
  const pathname = usePathname();
  const filesActive = pathname.includes("/files");
  const projectsActive = pathname.startsWith("/projects");
  const projectId = pathname.match(/^\/projects\/([^/]+)/u)?.[1];
  useMarcusRealtime("system.health", {});
  const realtime = useRealtimeStatus();
  const live = realtime.status === "online";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="border-b border-sidebar-border px-3 py-3.5">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild tooltip="Marcus Backoffice">
                <Link href="/overview">
                  <span className="brand-mark size-8 text-sm">M</span>
                  <span className="grid flex-1 text-left leading-tight">
                    <strong className="text-sm tracking-[0.1em]">MARCUS</strong>
                    <small className="text-[10px] tracking-[0.14em] text-muted-foreground">CONTROL PLANE</small>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Operación</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith("/overview")} tooltip="Centro de control"><Link href="/overview"><LayoutDashboard /><span>Centro de control</span></Link></SidebarMenuButton></SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={projectsActive} tooltip="Proyectos">
                    <Link href="/projects"><FolderKanban /><span>Proyectos</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith("/studio")} tooltip="Studio de agentes"><Link href="/studio"><Bot /><span>Agent Studio</span></Link></SidebarMenuButton></SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Runtime</SidebarGroupLabel>
            <SidebarGroupContent><SidebarMenu>
              <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith("/runs")} tooltip="Runs"><Link href="/runs"><RadioTower /><span>Runs</span></Link></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith("/runtime")} tooltip="Runtime y approvals"><Link href="/runtime"><Workflow /><span>Runtime</span></Link></SidebarMenuButton></SidebarMenuItem>
              {systemAdmin && <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith("/logs")} tooltip="Logs unificados"><Link href="/logs"><ScrollText /><span>Logs</span></Link></SidebarMenuButton></SidebarMenuItem>}
            </SidebarMenu></SidebarGroupContent>
          </SidebarGroup>
          {systemAdmin && <SidebarGroup>
            <SidebarGroupLabel>Configuración</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith("/general")} tooltip="General"><Link href="/general"><Settings2 /><span>General</span></Link></SidebarMenuButton></SidebarMenuItem>
                <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith("/providers")} tooltip="Proveedores"><Link href="/providers"><Boxes /><span>Proveedores</span></Link></SidebarMenuButton></SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <div className="mb-1 flex items-center gap-3 rounded-md bg-sidebar-accent/55 p-2.5 group-data-[collapsible=icon]:hidden">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar text-xs font-semibold text-sidebar-foreground">{username?.slice(0, 1).toUpperCase() ?? "A"}</span>
            <div className="min-w-0 flex-1"><strong className="block truncate text-xs font-semibold">{username ?? "Administrador"}</strong><span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldCheck className="size-3 text-primary" />Autoridad global</span></div>
          </div>
          <SidebarMenu><SidebarMenuItem><LogoutButton /></SidebarMenuItem></SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 bg-transparent">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 shadow-[0_1px_0_rgba(0,0,0,0.12)] backdrop-blur-md md:px-6">
          <SidebarTrigger aria-label="Alternar navegación" />
          <Separator orientation="vertical" className="h-5" />
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <Gauge className="size-4 text-muted-foreground" />
            <span className="hidden sm:inline">Plano de control</span>
            <ChevronRight className="hidden size-3 sm:block" />
            <strong className="truncate text-foreground">{pathname.startsWith("/overview") ? "Centro de control" : pathname.startsWith("/studio") ? "Agent Studio" : pathname.startsWith("/search") ? "Buscar" : pathname.startsWith("/logs") ? "Logs" : pathname.startsWith("/runtime") ? "Runtime" : pathname.startsWith("/general") ? "General" : pathname.startsWith("/providers") ? "Proveedores" : pathname.startsWith("/runs") ? "Runs" : pathname.includes("/agents/") ? "Agente" : pathname.includes("/editor") ? "Editor" : filesActive ? "Archivos" : projectId === undefined ? "Proyectos" : "Proyecto"}</strong>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant={pathname.startsWith("/search") ? "secondary" : "ghost"} size="sm">
              <Link href="/search" aria-label="Buscar"><Search /><span className="hidden lg:inline">Buscar</span></Link>
            </Button>
            <MarcusAiDrawer key={projectId ?? "global"} projectId={projectId === undefined ? undefined : decodeURIComponent(projectId)} />
            <ContextualHelp />
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={realtime.reconnect} disabled={realtime.status === "connecting"} title={realtime.lastEventAt === undefined ? "Canal de eventos de Marcus" : `Último evento: ${new Date(realtime.lastEventAt).toLocaleTimeString("es-AR")}`} data-realtime-status={realtime.status}>
              {!live && <RefreshCw className={realtime.status === "connecting" || realtime.status === "reconnecting" ? "animate-spin" : ""} />}
              <span className={`size-1.5 rounded-full ${live ? "bg-primary" : "bg-amber-400"}`} />
              <span className="hidden text-[10px] sm:inline">{live ? "EN VIVO" : realtime.status === "offline" ? "SIN CONEXIÓN" : "CONECTANDO"}</span>
            </Button>
            <Badge variant="outline" className="border-border bg-secondary text-[10px] text-muted-foreground">LOCAL</Badge>
          </div>
        </header>
        <main id="main-content" className="flex-1 p-4 md:p-8 xl:p-10">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
