import Link from "next/link";
import type { Metadata } from "next";
import { File, FileCode2, Folder, FolderKanban, HardDrive, Network } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { CreateFileDialog } from "@/components/create-file-dialog";
import { UploadFileDialog } from "@/components/upload-file-dialog";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestMarcus } from "@/lib/marcus/server";
import type { Project, ProjectFile } from "@/lib/marcus/types";

type Props = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Archivos" };

export default async function ProjectFilesPage({ params }: Props) {
  const { projectId } = await params;
  const filesQuery = new URLSearchParams({ path: "project:/" });
  const [projectsResult, filesResult] = await Promise.all([
    requestMarcus<Project[]>("/api/v1/projects"),
    requestMarcus<ProjectFile[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/files?${filesQuery}`),
  ]);
  const project = projectsResult.envelope.ok
    ? projectsResult.envelope.data.find((candidate) => candidate.projectId === projectId)
    : undefined;
  const files = filesResult.envelope.ok ? filesResult.envelope.data : [];
  const bytes = files.reduce((total, file) => total + file.size, 0);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-7">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link href="/projects">Proyectos</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink asChild><Link href={`/projects/${encodeURIComponent(projectId)}`}>{project?.name ?? projectId}</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Archivos</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <section className="page-heading">
        <div>
          <p className="eyebrow">project:/</p>
          <h1>Archivos</h1>
          <p>{project?.name ?? "Project Home"} · paths lógicos y escrituras con control de revisión.</p>
        </div>
        <div className="flex flex-wrap gap-2"><UploadFileDialog projectId={projectId} /><CreateFileDialog projectId={projectId} /></div>
      </section>

      {!filesResult.envelope.ok && <ApiErrorPanel code={filesResult.envelope.error.code} message={filesResult.envelope.error.message} />}

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Resumen de archivos">
        <Summary icon={FileCode2} label="Entradas" value={files.length.toString()} />
        <Summary icon={HardDrive} label="Tamaño visible" value={formatBytes(bytes)} />
        <Summary icon={Network} label="Raíz lógica" value="project:/" mono />
      </section>

      <Card className="border border-border/75 bg-card/55">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="flex items-center gap-2"><FolderKanban className="size-4 text-primary" />Contenido del Project Home</CardTitle>
          <CardDescription>Metadata autoritativa entregada por Marcus API.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {files.length === 0 && filesResult.envelope.ok ? (
            <Empty className="min-h-72 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><File /></EmptyMedia>
                <EmptyTitle>Este proyecto todavía está vacío</EmptyTitle>
                <EmptyDescription>Creá un archivo para comenzar a definir agentes, configuración o documentación.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea className="w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Path</TableHead><TableHead>Tipo</TableHead><TableHead>Tamaño</TableHead><TableHead>Revisión</TableHead><TableHead>Índice</TableHead><TableHead>Actualizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((file) => (
                    <TableRow key={file.fileId}>
                      <TableCell className="min-w-64 font-mono text-xs font-medium">{isEditable(file) ? <Link className="inline-flex items-center gap-2 hover:text-primary" href={`/projects/${encodeURIComponent(projectId)}/editor?${new URLSearchParams({ path: `project:/${file.relativePath}` })}`}><FileCode2 className="size-4 text-muted-foreground" />{file.relativePath}</Link> : <span className="inline-flex items-center gap-2">{file.kind === "directory" ? <Folder className="size-4 text-primary" /> : <FileCode2 className="size-4 text-muted-foreground" />}{file.relativePath}</span>}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{file.kind === "file" ? "archivo" : file.kind === "directory" ? "directorio" : "symlink"}</TableCell>
                      <TableCell className="font-mono text-xs">{formatBytes(file.size)}</TableCell>
                      <TableCell className="font-mono text-xs">v{file.revision}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{file.indexStatus}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(file.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ icon: Icon, label, value, mono = false }: { icon: typeof FileCode2; label: string; value: string; mono?: boolean }) {
  return (
    <Card size="sm" className="border border-border/70 bg-card/45">
      <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3">
        <div className="row-span-2 flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary"><Icon /></div>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={mono ? "font-mono text-base" : "text-lg"}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? "—"
    : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(timestamp);
}

function isEditable(file: ProjectFile): boolean {
  return file.kind === "file" && (file.mediaType?.startsWith("text/") === true || /\.(?:md|mdx|txt|json|ya?ml|toml|ts|tsx|js|jsx|css|html|xml|csv|sql|sh)$/iu.test(file.relativePath));
}
