"use client";

import { BookOpen, CircleHelp, ExternalLink, LifeBuoy } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type HelpContent = { title: string; purpose: string; inspect: string[]; recovery: string[] };

const defaultHelp: HelpContent = {
  title: "Plano de control",
  purpose: "Administrá Marcus desde una vista gobernada por el API y actualizada en tiempo real.",
  inspect: ["Revisá primero el estado LOCAL del header.", "Los códigos de error se pueden correlacionar en Logs."],
  recovery: ["Si el canal está desconectado, usá Reconectar.", "Verificá que marcusd y Marcus API estén activos."],
};

function helpFor(pathname: string): HelpContent {
  if (pathname.startsWith("/overview")) return { title: "Centro de control", purpose: "Resume salud, volumen, fallos y actividad reciente de toda la instalación.", inspect: ["Runs con error y approvals pendientes.", "Tendencia de ejecución y actividad reciente."], recovery: ["Abrí el Run afectado para revisar output y error.", "Usá Logs con el runId o traceId para correlacionar eventos."] };
  if (pathname.startsWith("/studio")) return { title: "Agent Studio", purpose: "Convierte una necesidad de negocio en un plan revisable y luego en una fuente Marcus.", inspect: ["Definí entradas, salidas, tools, límites y criterios de éxito.", "Revisá cada fase del modelo, compilador y activación en Actividad."], recovery: ["El detalle real del proveedor o compilador aparece en el último evento.", "Corregí el brief y generá una actividad nueva; la anterior queda visible hasta reemplazarla."] };
  if (pathname.includes("/editor")) return { title: "Editor de fuentes", purpose: "Edita archivos con control optimista o delega un cambio acotado a Marcus AI.", inspect: ["La revisión debe coincidir con el archivo actual.", "Agente AI valida, versiona y activa el Markdown antes de confirmar."], recovery: ["Ante un conflicto, recargá el archivo y reaplicá el cambio.", "Ante un error de compilación, revisá la fase y diagnóstico mostrados en Actividad."] };
  if (pathname.endsWith("/test-case")) return { title: "Test case del agente", purpose: "Ejecuta la versión activa con un ejemplo sintético construido desde su contrato API.", inspect: ["Revisá o editá el Input JSON antes de ejecutar.", "El estado y la respuesta del Run llegan por WebSocket."], recovery: ["Si el ejemplo no puede generarse, reintentá y revisá el contrato activo.", "Usá Abrir Run para correlacionar fallos con Runtime y Logs."] };
  if (/\/projects\/[^/]+\/agents\//u.test(pathname)) return { title: "Detalle del agente", purpose: "Inspecciona contrato, versiones, fuente compilada y acceso API del agente.", inspect: ["Confirmá la versión activa y el estado de la fuente.", "El Test case sigue el Run exclusivamente por WebSocket."], recovery: ["Si una versión no está activa, revisá el diagnóstico de compilación.", "Usá el runId para abrir trazabilidad y Logs."] };
  if (/\/projects\/[^/]+/u.test(pathname)) return { title: "Project", purpose: "Concentra dashboard, agentes, usuarios, tokens y archivos del dominio operativo.", inspect: ["El dashboard se actualiza con eventos del Project.", "Los tokens sólo habilitan los alcances explícitos del Project."], recovery: ["Si una sección queda parcial, verificá permisos y el estado del API.", "Usá Logs filtrando por projectId."] };
  if (pathname.startsWith("/projects")) return { title: "Projects", purpose: "Administra los límites de datos, acceso y ejecución de cada solución agentica.", inspect: ["Estado, fecha de actualización y acceso al detalle.", "Creá un Project antes de cargar fuentes o agentes."], recovery: ["Un error de creación conserva el formulario para corregirlo.", "Buscá por slug o projectId desde el header."] };
  if (pathname.startsWith("/runs")) return { title: "Runs", purpose: "Sigue cada ejecución desde admisión hasta resultado persistido.", inspect: ["Estado terminal, output, error y duración.", "Trace ID y Correlation ID para diagnóstico cruzado."], recovery: ["Cancelá sólo ejecuciones no terminales.", "Copiá runId o traceId y buscalo en Logs."] };
  if (pathname.startsWith("/runtime")) return { title: "Runtime", purpose: "Controla procesos, approvals humanos y schedules activos.", inspect: ["Procesos degradados y approvals pendientes.", "Toda acción operativa exige confirmación."], recovery: ["Revisá el Run antes de terminar un proceso.", "Si una acción falla, correlacioná el ID en Logs."] };
  if (pathname.startsWith("/logs")) return { title: "Logs", purpose: "Consulta el stream redacted unificado de marcusd, API y Backoffice.", inspect: ["Filtrá por fuente, nivel, operación, runId o traceId.", "Los eventos nuevos llegan por WebSocket sin un segundo scrollbar."], recovery: ["Reducí filtros si no aparecen resultados.", "Si el stream está desconectado, reintentá desde el estado del header."] };
  if (pathname.startsWith("/providers")) return { title: "Proveedores", purpose: "Configura proveedores, modelos y roles globales usados por Marcus.", inspect: ["Probá conectividad y catálogo antes de asignar un rol.", "agent.default es obligatorio para las capacidades AI."], recovery: ["El código del proveedor conserva el detalle HTTP seguro.", "Verificá URL base, secret ref y nombre exacto del modelo."] };
  if (pathname.startsWith("/general")) return { title: "Configuración general", purpose: "Administra identidad, administradores y tokens MCP globales.", inspect: ["Revisá impacto y alcance antes de cambios de autoridad.", "Los tokens MCP globales otorgan acceso administrativo."], recovery: ["Revocá inmediatamente credenciales que ya no se usen.", "Conservá al menos un administrador activo y verificable."] };
  return defaultHelp;
}

export function ContextualHelp() {
  const pathname = usePathname();
  const content = helpFor(pathname);
  return (
    <Sheet>
      <SheetTrigger asChild><Button variant="ghost" size="sm" aria-label="Ayuda de esta pantalla"><CircleHelp /><span className="hidden xl:inline">Ayuda</span></Button></SheetTrigger>
      <SheetContent className="w-[min(92vw,28rem)] sm:max-w-md">
        <SheetHeader className="border-b border-border p-5 pr-12"><div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><LifeBuoy /></div><SheetTitle>{content.title}</SheetTitle><SheetDescription className="leading-6">{content.purpose}</SheetDescription></SheetHeader>
        <div className="space-y-6 overflow-y-auto px-5 pb-6">
          <HelpSection title="Qué revisar" items={content.inspect} />
          <HelpSection title="Cómo recuperarte" items={content.recovery} />
          <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4 text-primary" />Documentación operacional</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Marcus AI conoce la documentación incluida con la instalación y puede explicar comandos, contratos y errores dentro del contexto actual.</p><Button className="mt-4 w-full" variant="outline" size="sm" asChild><a href="https://projectmarcus.com" target="_blank" rel="noreferrer">Abrir documentación pública<ExternalLink /></a></Button></div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HelpSection({ title, items }: { title: string; items: string[] }) {
  return <section><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3><ul className="mt-3 space-y-3">{items.map((item, index) => <li key={item} className="flex gap-3 text-sm leading-6"><span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded border border-border bg-secondary font-mono text-[10px] text-primary">{index + 1}</span><span>{item}</span></li>)}</ul></section>;
}
