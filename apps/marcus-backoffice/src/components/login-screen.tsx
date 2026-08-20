"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, KeyRound, LoaderCircle, Orbit, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestBff } from "@/lib/marcus/client";
import type { SessionStatus } from "@/lib/marcus/types";

export function LoginScreen({ apiAvailable }: { apiAvailable: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const session = await requestBff<SessionStatus>("/api/session/login", {
        method: "POST",
        body: JSON.stringify({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      if (session.csrf !== undefined) sessionStorage.setItem("marcus.csrf", session.csrf);
      router.replace("/overview");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión.");
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="login-stage">
      <section className="login-story" aria-labelledby="marcus-intro">
        <div className="brand-lockup">
          <span className="brand-mark">M</span>
          <span>
            <strong>MARCUS</strong>
            <small>AGENTIC OS</small>
          </span>
        </div>
        <Badge variant="outline" className="border-border bg-secondary text-muted-foreground">
          <span className="mr-1.5 size-1.5 rounded-full bg-primary" />
          Control plane local
        </Badge>
        <h1 id="marcus-intro">Tu infraestructura agéntica, bajo control.</h1>
        <p>
          Observá proyectos, archivos y ejecución desde una consola conectada a la autoridad real de Marcus.
        </p>
        <div className="signal-grid" aria-label="Arquitectura de conexión">
          <div><ShieldCheck /><span>RBAC en marcusd</span></div>
          <div><Orbit /><span>MNP/1</span></div>
          <div><Activity /><span>Estado observable</span></div>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <Card className="w-full max-w-md border-border bg-card shadow-xl shadow-black/20">
          <CardHeader className="gap-3 border-b border-border/70 pb-6">
            <div className="flex size-10 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
              <KeyRound className="size-5" />
            </div>
            <div>
              <CardTitle id="login-title" className="text-2xl">Ingresar al Backoffice</CardTitle>
              <CardDescription className="mt-1.5">
                Tus credenciales se validan directamente contra Marcus API y marcusd.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {!apiAvailable && (
              <Alert variant="destructive" className="mb-5">
                <AlertTitle>Marcus API no está disponible</AlertTitle>
                <AlertDescription>Iniciá la API en localhost y volvé a intentar.</AlertDescription>
              </Alert>
            )}
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="username">Usuario</FieldLabel>
                  <Input id="username" name="username" autoComplete="username" placeholder="admin" required autoFocus />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                  <Input id="password" name="password" type="password" autoComplete="current-password" required />
                </Field>
                <p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>
                <Button type="submit" size="lg" disabled={submitting} className="w-full">
                  {submitting ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
                  {submitting ? "Conectando…" : "Ingresar"}
                </Button>
              </FieldGroup>
            </form>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Sesión HttpOnly · CSRF activo · Sin credenciales de bypass en Next
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
