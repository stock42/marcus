"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { requestBff } from "@/lib/marcus/client";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    try {
      await requestBff("/api/session/logout", { method: "POST", body: "{}" });
      sessionStorage.removeItem("marcus.csrf");
      router.replace("/");
      router.refresh();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "No se pudo cerrar la sesión.");
    }
  }

  return (
    <SidebarMenuButton type="button" onClick={logout} tooltip="Cerrar sesión">
      <LogOut />
      <span>Cerrar sesión</span>
    </SidebarMenuButton>
  );
}
